import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Dev-only safeguard against the legacy product name leaking through the
// HTTP layer. Static-source occurrences are caught by scripts/check-naming.sh;
// this interceptor catches dynamic strings that the static scan can't see
// (template-built error messages, generated content from DB rows, etc.).
//
// Behavior:
//   - Active when NODE_ENV !== 'production' AND NAMING_LEAK_ASSERT !== 'off'.
//   - Default mode logs a WARN with route + offending excerpt.
//   - Set NAMING_LEAK_ASSERT=throw to fail the request (handy in e2e/CI).
//   - Production is always a no-op so the regex pass never touches hot paths.
@Injectable()
export class NamingLeakInterceptor implements NestInterceptor {
  private readonly logger = new Logger(NamingLeakInterceptor.name);
  private readonly enabled: boolean;
  private readonly throwOnLeak: boolean;
  private static readonly LEAK_RE = /[Aa]dari/;

  constructor() {
    const mode = process.env.NAMING_LEAK_ASSERT ?? 'warn';
    this.enabled = process.env.NODE_ENV !== 'production' && mode !== 'off';
    this.throwOnLeak = mode === 'throw';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const route = `${request?.method ?? 'UNKNOWN'} ${request?.originalUrl ?? request?.url ?? ''}`;

    return next.handle().pipe(
      tap((body) => {
        const leak = this.findLeak(body);
        if (!leak) return;

        const message = `naming-leak: legacy 'Adari' in response of ${route} → ${leak}`;
        if (this.throwOnLeak) {
          throw new InternalServerErrorException(message);
        }
        this.logger.warn(message);
      }),
    );
  }

  private findLeak(body: unknown): string | null {
    if (body === null || body === undefined) return null;
    if (Buffer.isBuffer(body)) return null;
    // Streams (e.g. file downloads) — don't drain them.
    if (typeof body === 'object' && body !== null && 'pipe' in body && typeof (body as { pipe: unknown }).pipe === 'function') {
      return null;
    }

    let serialized: string;
    try {
      serialized = typeof body === 'string' ? body : JSON.stringify(body);
    } catch {
      return null;
    }

    const match = NamingLeakInterceptor.LEAK_RE.exec(serialized);
    if (!match) return null;

    const start = Math.max(0, match.index - 20);
    const end = Math.min(serialized.length, match.index + 40);
    return serialized.slice(start, end);
  }
}

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Lightweight interceptor that attaches request metadata to the req object
// so AuditService can pick it up without needing HTTP context directly.
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    request.auditContext = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
    return next.handle().pipe(tap(() => {}));
  }
}

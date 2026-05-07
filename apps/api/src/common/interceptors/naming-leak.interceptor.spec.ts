import { CallHandler, ExecutionContext, InternalServerErrorException, Logger } from '@nestjs/common';
import { Observable, lastValueFrom, of, throwError } from 'rxjs';
import { NamingLeakInterceptor } from './naming-leak.interceptor';

function makeContext(method = 'GET', url = '/api/v1/test'): ExecutionContext {
  const httpCtx = {
    getRequest: () => ({ method, originalUrl: url }),
    getResponse: () => ({}),
  };
  return {
    getType: () => 'http',
    switchToHttp: () => httpCtx,
  } as unknown as ExecutionContext;
}

function makeHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('NamingLeakInterceptor', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_MODE = process.env.NAMING_LEAK_ASSERT;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    if (ORIGINAL_MODE === undefined) delete process.env.NAMING_LEAK_ASSERT;
    else process.env.NAMING_LEAK_ASSERT = ORIGINAL_MODE;
    jest.restoreAllMocks();
  });

  it('passes clean responses through untouched (warn mode)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NAMING_LEAK_ASSERT;
    const interceptor = new NamingLeakInterceptor();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), makeHandler({ name: 'Nasaq Ads' })) as Observable<unknown>,
    );

    expect(result).toEqual({ name: 'Nasaq Ads' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a warning when the legacy name appears in the body', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NAMING_LEAK_ASSERT;
    const interceptor = new NamingLeakInterceptor();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await lastValueFrom(
      interceptor.intercept(
        makeContext('POST', '/api/v1/orgs/x/campaigns'),
        makeHandler({ message: 'Welcome to Adari' }),
      ) as Observable<unknown>,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('naming-leak');
    expect(msg).toContain('POST /api/v1/orgs/x/campaigns');
  });

  it('matches case-insensitively (lower-case "adari")', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NAMING_LEAK_ASSERT;
    const interceptor = new NamingLeakInterceptor();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await lastValueFrom(
      interceptor.intercept(
        makeContext(),
        makeHandler({ description: 'powered by adari' }),
      ) as Observable<unknown>,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when NAMING_LEAK_ASSERT=throw', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NAMING_LEAK_ASSERT = 'throw';
    const interceptor = new NamingLeakInterceptor();

    await expect(
      lastValueFrom(
        interceptor.intercept(
          makeContext(),
          makeHandler({ x: 'Adari leak' }),
        ) as Observable<unknown>,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('is a no-op in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NAMING_LEAK_ASSERT;
    const interceptor = new NamingLeakInterceptor();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), makeHandler({ msg: 'Adari leak' })) as Observable<unknown>,
    );

    expect(result).toEqual({ msg: 'Adari leak' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when NAMING_LEAK_ASSERT=off', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NAMING_LEAK_ASSERT = 'off';
    const interceptor = new NamingLeakInterceptor();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await lastValueFrom(
      interceptor.intercept(makeContext(), makeHandler({ msg: 'Adari' })) as Observable<unknown>,
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips Buffer responses without scanning', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NAMING_LEAK_ASSERT;
    const interceptor = new NamingLeakInterceptor();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await lastValueFrom(
      interceptor.intercept(
        makeContext(),
        makeHandler(Buffer.from('contains Adari but is binary')),
      ) as Observable<unknown>,
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not interfere with downstream errors', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NAMING_LEAK_ASSERT;
    const interceptor = new NamingLeakInterceptor();
    const handler: CallHandler = { handle: () => throwError(() => new Error('downstream')) };

    await expect(
      lastValueFrom(interceptor.intercept(makeContext(), handler) as Observable<unknown>),
    ).rejects.toThrow('downstream');
  });
});

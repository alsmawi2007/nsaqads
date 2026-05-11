import { MetaProvider } from './meta.provider';
import { MockProvider } from '../mock/mock.provider';
import type { AdAccount } from '@prisma/client';
import type { AdAccountRef } from '../interfaces/ad-account-ref';

// MetaProvider.updateBidLimits has two regimes:
//   1. newBidFloor != null → must return success:false with errorCode UNSUPPORTED.
//      Meta has no native ad-set bid floor; silently swallowing the call would
//      cause the executor to record APPLIED for a no-op write.
//   2. newBidFloor == null && newBidCeiling != null → must reach the API path.

describe('MetaProvider — updateBidLimits honest failure', () => {
  const acc = {
    id: 'acc-1',
    platform: 'META',
    externalId: 'act_123',
    status: 'ACTIVE',
    accessToken: 'cipher',
  } as unknown as AdAccount;

  const ref: AdAccountRef = { id: acc.id, externalId: acc.externalId, platform: 'META' };

  function makeProvider(opts: { isMock?: boolean; postSpy?: jest.Mock } = {}) {
    const loader = {
      load: jest.fn().mockResolvedValue({ account: acc, accessToken: 'plain-token' }),
      isMock: jest.fn().mockReturnValue(opts.isMock ?? false),
    };
    const api = {
      post: opts.postSpy ?? jest.fn().mockResolvedValue({}),
      get: jest.fn(),
    };
    const tokens = { refreshIfNeeded: jest.fn().mockResolvedValue(undefined) };
    const mock = new MockProvider();
    const provider = new MetaProvider(
      mock,
      loader as never,
      api as never,
      {} as never,
      tokens as never,
    );
    return { provider, api, loader, mock };
  }

  it('returns success:false with errorCode UNSUPPORTED when newBidFloor is non-null', async () => {
    const { provider, api } = makeProvider();

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: 'as-1',
      newBidFloor: 1.5,
      newBidCeiling: null,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED');
    expect(result.errorMessage).toMatch(/bid floor/i);
    expect(result.externalId).toBe('as-1');
    // Crucially: the API must not have been called for the no-op floor write.
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reaches the API and returns success:true when newBidCeiling is set and floor is null', async () => {
    const postSpy = jest.fn().mockResolvedValue({});
    const { provider } = makeProvider({ postSpy });

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: 'as-1',
      newBidFloor: null,
      newBidCeiling: 2.5,
    });

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes supportsBidFloor=false in capabilities', () => {
    const { provider } = makeProvider();
    expect(provider.getCapabilities().supportsBidFloor).toBe(false);
    expect(provider.getCapabilities().supportsBidCeiling).toBe(true);
  });
});

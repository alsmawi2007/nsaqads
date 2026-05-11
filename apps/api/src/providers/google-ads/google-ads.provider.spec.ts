import { GoogleAdsProvider } from './google-ads.provider';
import { MockProvider } from '../mock/mock.provider';
import type { AdAccount } from '@prisma/client';
import type { AdAccountRef } from '../interfaces/ad-account-ref';

// GoogleAdsProvider.updateBidLimits has two regimes:
//   1. newBidFloor != null → must return success:false with errorCode UNSUPPORTED.
//      Google Ads bid floor is not surfaced uniformly in our v18 normalized path;
//      silently swallowing the call would cause the executor to record APPLIED
//      for a no-op write.
//   2. newBidFloor == null && newBidCeiling != null → must reach the API.

describe('GoogleAdsProvider — updateBidLimits honest failure', () => {
  const acc = {
    id: 'acc-1',
    platform: 'GOOGLE_ADS',
    externalId: '1234567890',
    status: 'ACTIVE',
    accessToken: 'cipher',
    refreshToken: 'cipher',
  } as unknown as AdAccount;

  const ref: AdAccountRef = { id: acc.id, externalId: acc.externalId, platform: 'GOOGLE_ADS' };

  function makeProvider(opts: { isMock?: boolean; mutateSpy?: jest.Mock; searchSpy?: jest.Mock } = {}) {
    const loader = {
      load: jest.fn().mockResolvedValue({ account: acc, accessToken: 'plain-token' }),
      isMock: jest.fn().mockReturnValue(opts.isMock ?? false),
    };
    const api = {
      mutate: opts.mutateSpy ?? jest.fn().mockResolvedValue({}),
      // searchAll resolves the ad-group → campaign relationship for ceiling writes.
      searchAll: opts.searchSpy ?? jest.fn().mockResolvedValue([
        { adGroup: { campaign: 'customers/1234567890/campaigns/777' } },
      ]),
      listAccessibleCustomers: jest.fn(),
    };
    const tokens = { refreshIfNeeded: jest.fn().mockResolvedValue(undefined) };
    const mock = new MockProvider();
    const provider = new GoogleAdsProvider(
      mock,
      loader as never,
      api as never,
      {} as never,
      tokens as never,
    );
    return { provider, api, loader, mock };
  }

  it('returns success:false with errorCode UNSUPPORTED when newBidFloor is non-null', async () => {
    const mutateSpy = jest.fn();
    const searchSpy = jest.fn();
    const { provider } = makeProvider({ mutateSpy, searchSpy });

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: '888',
      newBidFloor: 1.5,
      newBidCeiling: null,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED');
    expect(result.errorMessage).toMatch(/bid floor/i);
    expect(result.externalId).toBe('888');
    // Crucially: no API call must be attempted for the no-op floor write.
    expect(mutateSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('reaches the API and returns success:true when newBidCeiling is set and floor is null', async () => {
    const mutateSpy = jest.fn().mockResolvedValue({});
    const { provider } = makeProvider({ mutateSpy });

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: '888',
      newBidFloor: null,
      newBidCeiling: 2.5,
    });

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(mutateSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes supportsBidFloor=false in capabilities', () => {
    const { provider } = makeProvider();
    expect(provider.getCapabilities().supportsBidFloor).toBe(false);
    expect(provider.getCapabilities().supportsBidCeiling).toBe(true);
  });
});

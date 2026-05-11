import { SnapchatProvider } from './snapchat.provider';
import { MockProvider } from '../mock/mock.provider';
import type { AdAccount } from '@prisma/client';
import type { AdAccountRef } from '../interfaces/ad-account-ref';

// SnapchatProvider.updateBidLimits has two regimes:
//   1. newBidFloor != null → must return success:false with errorCode UNSUPPORTED.
//      Snap has no native ad-squad bid floor; silently swallowing the call
//      would cause the executor to record APPLIED for a no-op write.
//   2. newBidFloor == null && newBidCeiling != null → must reach the API
//      after resolving the parent campaign id.

describe('SnapchatProvider — updateBidLimits honest failure', () => {
  const acc = {
    id: 'acc-1',
    platform: 'SNAPCHAT',
    externalId: 'snap-acc-123',
    status: 'ACTIVE',
    accessToken: 'cipher',
    refreshToken: 'cipher',
  } as unknown as AdAccount;

  const ref: AdAccountRef = { id: acc.id, externalId: acc.externalId, platform: 'SNAPCHAT' };

  function makeProvider(opts: {
    isMock?: boolean;
    putSpy?: jest.Mock;
    getSpy?: jest.Mock;
  } = {}) {
    const loader = {
      load: jest.fn().mockResolvedValue({ account: acc, accessToken: 'plain-token' }),
      isMock: jest.fn().mockReturnValue(opts.isMock ?? false),
    };
    const api = {
      get: opts.getSpy ?? jest.fn().mockResolvedValue({
        adsquads: [{ adsquad: { id: 'sq-1', campaign_id: 'camp-1' } }],
      }),
      put: opts.putSpy ?? jest.fn().mockResolvedValue({}),
      post: jest.fn(),
      // Helpers used by the provider — wired through directly so tests can
      // assert call-shape rather than re-implementing the URL plumbing.
      getAdSquad: jest.fn().mockResolvedValue({ id: 'sq-1', campaign_id: 'camp-1' }),
      updateAdSquad: opts.putSpy ?? jest.fn().mockResolvedValue({}),
      updateCampaign: jest.fn().mockResolvedValue({}),
      listCampaigns: jest.fn().mockResolvedValue([]),
      listAdSquads:  jest.fn().mockResolvedValue([]),
      fetchStats:    jest.fn().mockResolvedValue(null),
    };
    const tokens = { refreshIfNeeded: jest.fn().mockResolvedValue(undefined) };
    const mapper = {
      toNormalizedCampaign: jest.fn(),
      toNormalizedAdSet:    jest.fn(),
      toNormalizedMetrics:  jest.fn(),
    };
    const mock = new MockProvider();
    const provider = new SnapchatProvider(
      mock,
      loader as never,
      api as never,
      mapper as never,
      tokens as never,
    );
    return { provider, api, loader, mock };
  }

  it('returns success:false with errorCode UNSUPPORTED when newBidFloor is non-null', async () => {
    const putSpy = jest.fn();
    const getSpy = jest.fn();
    const { provider, api } = makeProvider({ putSpy, getSpy });

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: 'sq-1',
      newBidFloor: 1.5,
      newBidCeiling: null,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED');
    expect(result.errorMessage).toMatch(/bid floor/i);
    expect(result.externalId).toBe('sq-1');
    // Crucially: no API call must be attempted for the no-op floor write.
    expect(api.updateAdSquad).not.toHaveBeenCalled();
    expect(api.getAdSquad).not.toHaveBeenCalled();
  });

  it('reaches the API and returns success:true when newBidCeiling is set and floor is null', async () => {
    const updateSpy = jest.fn().mockResolvedValue({});
    const { provider, api } = makeProvider();
    api.updateAdSquad = updateSpy;

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: 'sq-1',
      newBidFloor: null,
      newBidCeiling: 2.5,
    });

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(api.getAdSquad).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    // The body must carry the resolved bid_micro value (2.5 * 1_000_000).
    const body = updateSpy.mock.calls[0][2] as { bid_micro?: number };
    expect(body.bid_micro).toBe(2_500_000);
  });

  it('exposes Snapchat capabilities correctly', () => {
    const { provider } = makeProvider();
    const caps = provider.getCapabilities();
    expect(caps.supportsBidFloor).toBe(false);
    expect(caps.supportsBidCeiling).toBe(true);
    expect(caps.supportsRoasGoal).toBe(false);
    expect(caps.supportsCpaGoal).toBe(true);
    expect(caps.supportsCbo).toBe(true);
    expect(caps.supportsLifetimeBudget).toBe(true);
    expect(caps.supportsCampaignCreation).toBe(false);
    expect(caps.supportsCreativeUpload).toBe(false);
  });
});

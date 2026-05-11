import { TikTokProvider } from './tiktok.provider';
import { MockProvider } from '../mock/mock.provider';
import type { AdAccount } from '@prisma/client';
import type { AdAccountRef } from '../interfaces/ad-provider.interface';

// TikTokProvider.updateBidLimits has two regimes:
//   1. newBidFloor != null → must return success:false with errorCode UNSUPPORTED.
//      TikTok has no native ad-group bid floor; silently swallowing the call
//      would cause the executor to record APPLIED for a no-op write.
//   2. newBidFloor == null && newBidCeiling != null → must reach the API
//      via /adgroup/update/ with bid_type=BID_TYPE_CUSTOM and bid_price set.
//
// Unlike Snap/Google, TikTok ad-group writes do NOT need parent resolution —
// advertiser_id + adgroup_id is enough.

describe('TikTokProvider — updateBidLimits honest failure', () => {
  const acc = {
    id: 'acc-1',
    platform: 'TIKTOK',
    externalId: 'tt-adv-123',
    status: 'ACTIVE',
    accessToken: 'cipher',
    refreshToken: 'cipher',
  } as unknown as AdAccount;

  const ref: AdAccountRef = { id: acc.id, externalId: acc.externalId, platform: 'TIKTOK' };

  function makeProvider(opts: {
    isMock?: boolean;
    updateAdGroupSpy?: jest.Mock;
  } = {}) {
    const loader = {
      load: jest.fn().mockResolvedValue({ account: acc, accessToken: 'plain-token' }),
      isMock: jest.fn().mockReturnValue(opts.isMock ?? false),
    };
    const api = {
      get: jest.fn(),
      post: jest.fn(),
      getAdvertiser:  jest.fn().mockResolvedValue({ advertiser_id: acc.externalId }),
      listCampaigns:  jest.fn().mockResolvedValue([]),
      listAdGroups:   jest.fn().mockResolvedValue([]),
      fetchReport:    jest.fn().mockResolvedValue(null),
      updateCampaign: jest.fn().mockResolvedValue({}),
      updateAdGroup:  opts.updateAdGroupSpy ?? jest.fn().mockResolvedValue({}),
    };
    const tokens = { refreshIfNeeded: jest.fn().mockResolvedValue(undefined) };
    const mapper = {
      toNormalizedCampaign: jest.fn(),
      toNormalizedAdSet:    jest.fn(),
      toNormalizedMetrics:  jest.fn(),
    };
    const mock = new MockProvider();
    const provider = new TikTokProvider(
      mock,
      loader as never,
      api as never,
      mapper as never,
      tokens as never,
    );
    return { provider, api, loader, mock };
  }

  it('returns success:false with errorCode UNSUPPORTED when newBidFloor is non-null', async () => {
    const updateAdGroupSpy = jest.fn();
    const { provider, api } = makeProvider({ updateAdGroupSpy });

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: 'ag-1',
      newBidFloor: 1.5,
      newBidCeiling: null,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED');
    expect(result.errorMessage).toMatch(/bid floor/i);
    expect(result.externalId).toBe('ag-1');
    // Crucially: no API call must be attempted for the no-op floor write.
    expect(api.updateAdGroup).not.toHaveBeenCalled();
  });

  it('reaches the API and returns success:true when newBidCeiling is set and floor is null', async () => {
    const updateSpy = jest.fn().mockResolvedValue({});
    const { provider, api } = makeProvider();
    api.updateAdGroup = updateSpy;

    const result = await provider.updateBidLimits(ref, {
      adSetExternalId: 'ag-1',
      newBidFloor: null,
      newBidCeiling: 2.5,
    });

    expect(result.success).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    // The body must carry the resolved bid_price + BID_TYPE_CUSTOM atomic switch.
    const body = updateSpy.mock.calls[0][2] as {
      adgroup_id?: string; bid_type?: string; bid_price?: number;
    };
    expect(body.adgroup_id).toBe('ag-1');
    expect(body.bid_type).toBe('BID_TYPE_CUSTOM');
    expect(body.bid_price).toBe(2.5);
  });

  it('exposes TikTok capabilities correctly', () => {
    const { provider } = makeProvider();
    const caps = provider.getCapabilities();
    expect(caps.supportsBidFloor).toBe(false);
    expect(caps.supportsBidCeiling).toBe(true);
    expect(caps.supportsRoasGoal).toBe(true);
    expect(caps.supportsCpaGoal).toBe(true);
    expect(caps.supportsCbo).toBe(true);
    expect(caps.supportsLifetimeBudget).toBe(true);
    expect(caps.supportsCampaignCreation).toBe(false);
    expect(caps.supportsCreativeUpload).toBe(false);
  });
});

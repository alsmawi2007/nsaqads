import { BudgetType, CampaignGoal, FunnelStage, Platform } from '@prisma/client';
import { BiddingStrategy } from '../../providers/interfaces/ad-provider.interface';
import {
  makeAdAccounts,
  makeWizardInput,
} from '../__fixtures__/wizard-input.fixture';
import { DecisionEngineService } from './decision-engine.service';

describe('DecisionEngineService', () => {
  const engine = new DecisionEngineService();

  describe('goal → funnel mapping', () => {
    const cases: Array<[CampaignGoal, FunnelStage]> = [
      [CampaignGoal.AWARENESS, FunnelStage.TOFU],
      [CampaignGoal.TRAFFIC, FunnelStage.TOFU],
      [CampaignGoal.ENGAGEMENT, FunnelStage.MOFU],
      [CampaignGoal.LEADS, FunnelStage.MOFU],
      [CampaignGoal.APP_INSTALLS, FunnelStage.MOFU],
      [CampaignGoal.SALES, FunnelStage.BOFU],
    ];
    it.each(cases)('maps %s to %s', (goal, stage) => {
      const draft = engine.build({
        input: makeWizardInput({ goal, goalDetail: {} }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.funnelStage).toBe(stage);
    });
  });

  describe('budget allocation', () => {
    it('splits DAILY total by goal share', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          budget: { totalBudget: 1000, budgetType: BudgetType.DAILY, currency: 'USD' },
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      const meta = draft.items.find((i) => i.platform === Platform.META)!;
      const google = draft.items.find((i) => i.platform === Platform.GOOGLE_ADS)!;
      expect(meta.dailyBudget).toBe(550); // 55% of 1000
      expect(google.dailyBudget).toBe(450); // 45%
      expect(meta.dailyBudget + google.dailyBudget).toBe(1000);
    });

    it('divides LIFETIME budget by duration', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          budget: { totalBudget: 3000, budgetType: BudgetType.LIFETIME, currency: 'USD' },
          timeline: { startDate: '2026-05-06', endDate: '2026-05-16' }, // 10 days
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.durationDays).toBe(10);
      const meta = draft.items.find((i) => i.platform === Platform.META)!;
      // 55% of 3000 / 10 = 165
      expect(meta.dailyBudget).toBe(165);
    });

    it('rescales shares when a single platform is selected', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          platformSelection: {
            platforms: [Platform.META],
            adAccountIds: { META: 'acc-meta' },
          },
          budget: { totalBudget: 400, budgetType: BudgetType.DAILY, currency: 'USD' },
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts().filter((a) => a.platform === Platform.META),
      });
      expect(draft.items).toHaveLength(1);
      expect(draft.items[0].dailyBudget).toBe(400); // full budget
      expect(draft.items[0].platform).toBe(Platform.META);
    });

    it('filters out TIKTOK / SNAPCHAT and tracks them as rejected', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          platformSelection: {
            platforms: [Platform.META, Platform.TIKTOK, Platform.SNAPCHAT],
            adAccountIds: {
              META: 'acc-meta',
              TIKTOK: 'acc-tt',
              SNAPCHAT: 'acc-sc',
            },
          },
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts().filter((a) => a.platform === Platform.META),
      });
      expect(draft.items.map((i) => i.platform)).toEqual([Platform.META]);
      expect(draft.reasoning.supportedPlatforms.rejected).toEqual([
        Platform.TIKTOK,
        Platform.SNAPCHAT,
      ]);
    });
  });

  describe('bidding strategy defaults', () => {
    it('SALES with targetRoas → TARGET_ROAS', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          goalDetail: { targetRoas: 4.0 },
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.items[0].biddingStrategy).toBe(BiddingStrategy.TARGET_ROAS);
      expect(draft.items[0].bidTarget).toBe(4.0);
    });

    it('SALES with targetCpa (no roas) → TARGET_CPA', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          goalDetail: { targetCpa: 30 },
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.items[0].biddingStrategy).toBe(BiddingStrategy.TARGET_CPA);
      expect(draft.items[0].bidTarget).toBe(30);
    });

    it('SALES with no targets → LOWEST_COST', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.SALES,
          goalDetail: {},
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.items[0].biddingStrategy).toBe(BiddingStrategy.LOWEST_COST);
      expect(draft.items[0].bidTarget).toBeNull();
    });

    it('TRAFFIC → LOWEST_COST regardless of targets', () => {
      const draft = engine.build({
        input: makeWizardInput({
          goal: CampaignGoal.TRAFFIC,
          goalDetail: { targetCpa: 5 },
        }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.items[0].biddingStrategy).toBe(BiddingStrategy.LOWEST_COST);
      expect(draft.items[0].bidTarget).toBeNull();
    });
  });

  describe('objective mapping', () => {
    it('SALES → CONVERSIONS on both Meta and Google', () => {
      const draft = engine.build({
        input: makeWizardInput({ goal: CampaignGoal.SALES }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(
        draft.items.find((i) => i.platform === Platform.META)!.objective,
      ).toBe('CONVERSIONS');
      expect(
        draft.items.find((i) => i.platform === Platform.GOOGLE_ADS)!.objective,
      ).toBe('CONVERSIONS');
    });

    it('AWARENESS → REACH on Meta, DISPLAY_REACH on Google', () => {
      const draft = engine.build({
        input: makeWizardInput({ goal: CampaignGoal.AWARENESS }),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(
        draft.items.find((i) => i.platform === Platform.META)!.objective,
      ).toBe('REACH');
      expect(
        draft.items.find((i) => i.platform === Platform.GOOGLE_ADS)!.objective,
      ).toBe('DISPLAY_REACH');
    });
  });

  describe('CBO defaults', () => {
    it('Meta = true, Google = false', () => {
      const draft = engine.build({
        input: makeWizardInput(),
        orgSettings: {},
        adAccounts: makeAdAccounts(),
      });
      expect(draft.items.find((i) => i.platform === Platform.META)!.isCbo).toBe(true);
      expect(draft.items.find((i) => i.platform === Platform.GOOGLE_ADS)!.isCbo).toBe(false);
    });
  });
});

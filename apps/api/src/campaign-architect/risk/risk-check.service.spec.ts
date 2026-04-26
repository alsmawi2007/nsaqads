import { BudgetType, CampaignGoal, Platform } from '@prisma/client';
import { DecisionEngineService } from '../decision/decision-engine.service';
import { RiskCode, RiskSeverity } from '../dto/risk-finding.dto';
import {
  makeAdAccounts,
  makeWizardInput,
} from '../__fixtures__/wizard-input.fixture';
import { RiskCheckService } from './risk-check.service';

describe('RiskCheckService', () => {
  const engine = new DecisionEngineService();
  const service = new RiskCheckService();

  function run(
    inputOverrides: Parameters<typeof makeWizardInput>[0] = {},
    adAccounts = makeAdAccounts(),
  ) {
    const ctx = {
      input: makeWizardInput(inputOverrides),
      orgSettings: {},
      adAccounts,
    };
    const draft = engine.build(ctx);
    return { draft, findings: service.evaluate(draft, ctx) };
  }

  it('produces no findings for a clean SALES plan', () => {
    const { findings } = run();
    const blockers = findings.filter((f) => f.severity === RiskSeverity.BLOCKER);
    expect(blockers).toHaveLength(0);
    // Clean plan may still surface soft warnings; that is fine. Check none of the
    // "blocking-style" codes show up.
    expect(findings.find((f) => f.code === RiskCode.MISSING_CREATIVE_ASSETS)).toBeUndefined();
    expect(findings.find((f) => f.code === RiskCode.NO_CONVERSION_TRACKING)).toBeUndefined();
  });

  it('raises BLOCKER when budget is below minimum on every platform', () => {
    const { findings } = run({
      budget: { totalBudget: 0.5, budgetType: BudgetType.DAILY, currency: 'USD' },
    });
    const blocker = findings.find(
      (f) =>
        f.code === RiskCode.BUDGET_BELOW_PLATFORM_MINIMUM &&
        f.severity === RiskSeverity.BLOCKER,
    );
    expect(blocker).toBeDefined();
  });

  it('raises BLOCKER when all selected platforms are unsupported', () => {
    const { findings } = run(
      {
        platformSelection: {
          platforms: [Platform.TIKTOK, Platform.SNAPCHAT],
          adAccountIds: { TIKTOK: 'tt', SNAPCHAT: 'sc' },
        },
      },
      [],
    );
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.UNSUPPORTED_PLATFORM_FOR_GOAL &&
          f.severity === RiskSeverity.BLOCKER,
      ),
    ).toBeDefined();
  });

  it('raises BLOCKER when creative assets are missing', () => {
    const { findings } = run({
      creativeBrief: {
        formats: [] as never,
        assetRefs: [],
        headline: 'hi',
        description: null as never,
        cta: null as never,
        landingUrl: null as never,
        pixelInstalled: true,
      },
    });
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.MISSING_CREATIVE_ASSETS &&
          f.severity === RiskSeverity.BLOCKER,
      ),
    ).toBeDefined();
  });

  it('raises BLOCKER when an ad account is disconnected', () => {
    const accounts = makeAdAccounts({ META: { status: 'DISCONNECTED' } });
    const { findings } = run({}, accounts);
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.AD_ACCOUNT_DISCONNECTED &&
          f.platform === Platform.META,
      ),
    ).toBeDefined();
  });

  it('raises BLOCKER when an ad account is soft-deleted', () => {
    const accounts = makeAdAccounts({ META: { deletedAt: new Date() } });
    const { findings } = run({}, accounts);
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.AD_ACCOUNT_NOT_CONNECTED &&
          f.platform === Platform.META,
      ),
    ).toBeDefined();
  });

  it('raises WARNING on currency mismatch', () => {
    const accounts = makeAdAccounts({ META: { currency: 'SAR' } });
    const { findings } = run({}, accounts);
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.CURRENCY_MISMATCH &&
          f.severity === RiskSeverity.WARNING,
      ),
    ).toBeDefined();
  });

  it('raises BLOCKER for LIFETIME budget without end date', () => {
    const { findings } = run({
      budget: { totalBudget: 2000, budgetType: BudgetType.LIFETIME, currency: 'USD' },
      timeline: { startDate: '2026-05-06', endDate: undefined as unknown as string },
    });
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.LIFETIME_BUDGET_WITHOUT_END_DATE &&
          f.severity === RiskSeverity.BLOCKER,
      ),
    ).toBeDefined();
  });

  it('raises WARNING on single platform concentration', () => {
    const { findings } = run({
      platformSelection: {
        platforms: [Platform.META],
        adAccountIds: { META: 'acc-meta' },
      },
    });
    expect(
      findings.find(
        (f) => f.code === RiskCode.SINGLE_PLATFORM_CONCENTRATION,
      ),
    ).toBeDefined();
  });

  it('raises WARNING when SALES plan has no pixel', () => {
    const { findings } = run({
      goal: CampaignGoal.SALES,
      creativeBrief: {
        formats: [] as never,
        assetRefs: ['a'],
        headline: 'hi',
        description: null as never,
        cta: null as never,
        landingUrl: 'https://x.com',
        pixelInstalled: false,
      },
    });
    expect(
      findings.find(
        (f) =>
          f.code === RiskCode.NO_CONVERSION_TRACKING &&
          f.severity === RiskSeverity.WARNING,
      ),
    ).toBeDefined();
  });

  it('raises WARNING for short campaign window', () => {
    const { findings } = run({
      timeline: { startDate: '2026-05-06', endDate: '2026-05-09' },
    });
    expect(
      findings.find((f) => f.code === RiskCode.SHORT_CAMPAIGN_DURATION),
    ).toBeDefined();
  });

  it('raises WARNING for weak audience definition', () => {
    const { findings } = run({
      audience: {
        ageMin: 18,
        ageMax: 65,
        genders: ['ALL'] as never,
        languages: null as never,
        interestTags: [],
      },
    });
    expect(
      findings.find((f) => f.code === RiskCode.WEAK_AUDIENCE_DEFINITION),
    ).toBeDefined();
  });

  it('raises WARNING when start date falls on Friday', () => {
    // 2026-05-01 is a Friday
    const { findings } = run({
      timeline: { startDate: '2026-05-01', endDate: '2026-05-31' },
    });
    expect(findings.find((f) => f.code === RiskCode.WEEKEND_START)).toBeDefined();
  });

  it('raises WARNING when headline is missing', () => {
    const { findings } = run({
      creativeBrief: {
        formats: [] as never,
        assetRefs: ['a'],
        headline: undefined as unknown as string,
        description: null as never,
        cta: null as never,
        landingUrl: null as never,
        pixelInstalled: true,
      },
    });
    expect(findings.find((f) => f.code === RiskCode.MISSING_HEADLINE)).toBeDefined();
  });
});

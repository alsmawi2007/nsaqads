import { BudgetType, CampaignGoal, Platform } from '@prisma/client';
import {
  AudienceGender,
  CreativeFormat,
  WizardInputDto,
} from '../dto/wizard-input.dto';
import { ConnectedAdAccount } from '../types';

export function makeWizardInput(
  overrides: Partial<WizardInputDto> = {},
): WizardInputDto {
  const base: WizardInputDto = {
    name: 'Summer launch — GCC',
    goal: CampaignGoal.SALES,
    goalDetail: { targetRoas: 3.5 },
    geography: { countries: ['SA', 'AE'] },
    audience: {
      ageMin: 25,
      ageMax: 45,
      genders: [AudienceGender.ALL],
      languages: ['ar', 'en'],
      interestTags: ['fitness', 'healthy food', 'wellness'],
    },
    budget: {
      totalBudget: 500,
      budgetType: BudgetType.DAILY,
      currency: 'USD',
    },
    timeline: { startDate: '2026-05-06', endDate: '2026-06-05' },
    platformSelection: {
      platforms: [Platform.META, Platform.GOOGLE_ADS],
      adAccountIds: {
        META: 'acc-meta',
        GOOGLE_ADS: 'acc-google',
      },
    },
    creativeBrief: {
      formats: [CreativeFormat.IMAGE, CreativeFormat.VIDEO],
      assetRefs: ['asset-1', 'asset-2'],
      headline: 'Shop the summer collection',
      description: 'Free shipping across the GCC.',
      cta: 'SHOP_NOW',
      landingUrl: 'https://example.com/summer',
      pixelInstalled: true,
    },
  };
  return { ...base, ...overrides } as WizardInputDto;
}

export function makeAdAccounts(
  overrides: Partial<
    Record<Platform, Partial<ConnectedAdAccount>>
  > = {},
): ConnectedAdAccount[] {
  const accounts: ConnectedAdAccount[] = [
    {
      id: 'acc-meta',
      platform: Platform.META,
      currency: 'USD',
      status: 'ACTIVE',
      deletedAt: null,
      ...(overrides.META ?? {}),
    },
    {
      id: 'acc-google',
      platform: Platform.GOOGLE_ADS,
      currency: 'USD',
      status: 'ACTIVE',
      deletedAt: null,
      ...(overrides.GOOGLE_ADS ?? {}),
    },
  ];
  return accounts;
}

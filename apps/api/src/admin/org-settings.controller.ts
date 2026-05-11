import {
  Controller, Get, Patch, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminSettingsService } from './admin-settings.service';

type OptimizerMode = 'OFF' | 'SUGGEST_ONLY' | 'AUTO_APPLY';

interface OptimizerSettingsDto {
  enabled: boolean;
  defaultMode: OptimizerMode;
  maxBudgetIncreasePct: number;
  maxBudgetDecreasePct: number;
  maxBidChangePct: number;
  targetRoas: number | null;
  targetCpa: number | null;
  minSampleImpressions: number;
  cooldownHours: number;
  cycleIntervalMinutes: number;
}

// DTO field ↔ admin_settings key. Single source of truth for the mapping.
const FIELD_TO_KEY: Record<keyof OptimizerSettingsDto, string> = {
  enabled:              'optimizer.enabled',
  defaultMode:          'optimizer.default_mode',
  maxBudgetIncreasePct: 'optimizer.max_budget_increase_pct',
  maxBudgetDecreasePct: 'optimizer.max_budget_decrease_pct',
  maxBidChangePct:      'optimizer.max_bid_change_pct',
  targetRoas:           'optimizer.target_roas',
  targetCpa:            'optimizer.target_cpa',
  minSampleImpressions: 'optimizer.min_sample_impressions',
  cooldownHours:        'optimizer.cooldown_hours',
  cycleIntervalMinutes: 'optimizer.cycle_interval_minutes',
};

@ApiTags('Org Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/settings')
export class OrgSettingsController {
  constructor(private settings: AdminSettingsService) {}

  @Get('optimizer')
  @ApiOperation({ summary: 'Resolve optimizer settings for this org (org override → global → compile default)' })
  async getOptimizer(@Param('orgId') orgId: string): Promise<OptimizerSettingsDto> {
    const all = await this.settings.getAll(orgId);
    return {
      enabled:              all['optimizer.enabled']                  as boolean,
      defaultMode:          all['optimizer.default_mode']             as OptimizerMode,
      maxBudgetIncreasePct: all['optimizer.max_budget_increase_pct']  as number,
      maxBudgetDecreasePct: all['optimizer.max_budget_decrease_pct']  as number,
      maxBidChangePct:      all['optimizer.max_bid_change_pct']       as number,
      targetRoas:           all['optimizer.target_roas']              as number | null,
      targetCpa:            all['optimizer.target_cpa']               as number | null,
      minSampleImpressions: all['optimizer.min_sample_impressions']   as number,
      cooldownHours:        all['optimizer.cooldown_hours']           as number,
      cycleIntervalMinutes: all['optimizer.cycle_interval_minutes']   as number,
    };
  }

  @Patch('optimizer')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update org-level optimizer settings (ADMIN+)' })
  async updateOptimizer(
    @Param('orgId') orgId: string,
    @Body() body: Partial<OptimizerSettingsDto>,
    @CurrentUser() user: { sub: string },
  ) {
    for (const [field, key] of Object.entries(FIELD_TO_KEY) as [keyof OptimizerSettingsDto, string][]) {
      if (field in body) {
        await this.settings.upsert(key, body[field], orgId, user.sub);
      }
    }
  }
}

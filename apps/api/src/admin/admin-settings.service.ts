import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Compile-time defaults — the final fallback when no DB setting exists.
const DEFAULTS: Record<string, unknown> = {
  'optimizer.enabled': true,
  'optimizer.cooldown_hours': 24,
  'optimizer.max_budget_increase_pct': 30,
  'optimizer.max_budget_decrease_pct': 20,
  'optimizer.min_sample_impressions': 1000,
  'optimizer.cycle_interval_minutes': 60,
  'optimizer.default_mode': 'SUGGEST_ONLY',
};

@Injectable()
export class AdminSettingsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // Layered resolver: org override → global → compile-time constant
  async get<T = unknown>(key: string, orgId?: string): Promise<T> {
    if (orgId) {
      const orgSetting = await this.prisma.adminSetting.findUnique({
        where: { orgId_key: { orgId, key } },
      });
      if (orgSetting !== null) return orgSetting.value as T;
    }

    const global = await this.prisma.adminSetting.findUnique({
      where: { orgId_key: { orgId: null as unknown as string, key } },
    });
    if (global !== null) return global.value as T;

    if (key in DEFAULTS) return DEFAULTS[key] as T;

    throw new Error(`AdminSetting '${key}' has no value and no compile-time default`);
  }

  // Load all settings for an org (used by optimizer cycle setup)
  async getAll(orgId?: string): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = { ...DEFAULTS };

    const globals = await this.prisma.adminSetting.findMany({ where: { orgId: null } });
    globals.forEach((s) => { result[s.key] = s.value; });

    if (orgId) {
      const orgSettings = await this.prisma.adminSetting.findMany({ where: { orgId } });
      orgSettings.forEach((s) => { result[s.key] = s.value; });
    }

    return result;
  }

  async upsert(key: string, value: unknown, orgId: string | null, userId: string) {
    const before = await this.prisma.adminSetting.findUnique({
      where: { orgId_key: { orgId: orgId as string, key } },
    });

    const setting = await this.prisma.adminSetting.upsert({
      where: { orgId_key: { orgId: orgId as string, key } },
      update: { value: value as never, updatedById: userId },
      create: { orgId: orgId as string | undefined, key, value: value as never, updatedById: userId },
    });

    await this.audit.log({
      orgId: orgId ?? undefined,
      userId,
      action: 'admin_setting.upsert',
      resourceType: 'AdminSetting',
      beforeState: before ? { value: before.value } : undefined,
      afterState: { key, value },
    });

    return setting;
  }

  async delete(key: string, orgId: string | null, userId: string) {
    await this.prisma.adminSetting.delete({
      where: { orgId_key: { orgId: orgId as string, key } },
    });
    await this.audit.log({
      orgId: orgId ?? undefined, userId,
      action: 'admin_setting.delete',
      resourceType: 'AdminSetting',
      beforeState: { key },
    });
  }

  async listGlobal() {
    return this.prisma.adminSetting.findMany({ where: { orgId: null } });
  }

  async listForOrg(orgId: string) {
    return this.prisma.adminSetting.findMany({ where: { orgId } });
  }
}

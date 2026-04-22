import { Injectable, Logger } from '@nestjs/common';
import { AlertType, AlertSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAlertInput {
  orgId: string;
  entityType: string;
  entityId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  context?: Record<string, unknown>;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private prisma: PrismaService) {}

  // dedup_key = orgId:entityType:entityId:alertType
  // Only one active (unresolved) alert per dedup_key at a time.
  async raise(input: CreateAlertInput): Promise<void> {
    const dedupKey = `${input.orgId}:${input.entityType}:${input.entityId}:${input.alertType}`;

    const existing = await this.prisma.alert.findFirst({
      where: { dedupKey, resolvedAt: null },
    });

    if (existing) {
      // Bump updatedAt to surface the alert again
      await this.prisma.alert.update({
        where: { id: existing.id },
        data: { updatedAt: new Date(), context: input.context as never ?? existing.context },
      });
      return;
    }

    await this.prisma.alert.create({
      data: {
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        alertType: input.alertType,
        severity: input.severity,
        message: input.message,
        context: input.context as never,
        dedupKey,
        routedVia: ['in_app'],
      },
    });

    this.logger.log(`Alert raised: ${dedupKey} [${input.severity}]`);
  }

  // Auto-resolve alerts where the triggering condition no longer holds.
  // Called after each optimizer cycle with conditions map.
  async autoResolve(orgId: string, resolvedConditions: string[]): Promise<void> {
    for (const dedupKey of resolvedConditions) {
      await this.prisma.alert.updateMany({
        where: { orgId, dedupKey, resolvedAt: null },
        data: { resolvedAt: new Date(), resolutionNote: 'auto-resolved: condition cleared' },
      });
    }
  }

  async list(orgId: string, filters: { severity?: string; isRead?: boolean; entityId?: string }) {
    return this.prisma.alert.findMany({
      where: {
        orgId,
        ...(filters.severity ? { severity: filters.severity as AlertSeverity } : {}),
        ...(filters.isRead !== undefined ? { isRead: filters.isRead } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(alertId: string): Promise<void> {
    await this.prisma.alert.update({ where: { id: alertId }, data: { isRead: true } });
  }

  async markAllRead(orgId: string): Promise<void> {
    await this.prisma.alert.updateMany({ where: { orgId, isRead: false }, data: { isRead: true } });
  }

  async resolve(alertId: string, userId: string, note?: string): Promise<void> {
    await this.prisma.alert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date(), resolvedById: userId, resolutionNote: note },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async getForEntity(
    orgId: string,
    entityType: string,
    entityId: string,
    windowHours: 24 | 48 | 72,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.metricSnapshot.findFirst({
      where: { orgId, entityType, entityId, windowHours, snapshotDate: today },
    });
  }

  async getHistory(orgId: string, entityType: string, entityId: string, days = 7) {
    const from = new Date();
    from.setDate(from.getDate() - days);

    return this.prisma.metricSnapshot.findMany({
      where: {
        orgId, entityType, entityId, windowHours: 24,
        snapshotDate: { gte: from },
      },
      orderBy: { snapshotDate: 'desc' },
    });
  }
}

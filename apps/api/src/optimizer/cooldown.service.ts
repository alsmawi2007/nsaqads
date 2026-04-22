import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CooldownService {
  constructor(
    @InjectRedis() private redis: Redis,
    private prisma: PrismaService,
  ) {}

  private key(entityType: string, entityId: string, actionType: string): string {
    return `cooldown:${entityType}:${entityId}:${actionType}`;
  }

  async isOnCooldown(entityType: string, entityId: string, actionType: string): Promise<boolean> {
    // Fast path: Redis
    const cached = await this.redis.get(this.key(entityType, entityId, actionType));
    if (cached !== null) return true;

    // Slow path: Postgres (authoritative on Redis miss / restart)
    const tracker = await this.prisma.cooldownTracker.findUnique({
      where: { entityType_entityId_actionType: { entityType, entityId, actionType } },
    });

    if (!tracker || tracker.expiresAt <= new Date()) return false;

    // Warm Redis cache from DB
    const ttlSeconds = Math.floor((tracker.expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds > 0) {
      await this.redis.set(this.key(entityType, entityId, actionType), '1', 'EX', ttlSeconds);
    }

    return true;
  }

  async registerCooldown(
    orgId: string,
    entityType: string,
    entityId: string,
    actionType: string,
    cooldownHours: number,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + cooldownHours * 3_600_000);

    await this.prisma.cooldownTracker.upsert({
      where: { entityType_entityId_actionType: { entityType, entityId, actionType } },
      update: { lastActionAt: now, cooldownHours, expiresAt, orgId },
      create: { orgId, entityType, entityId, actionType, lastActionAt: now, cooldownHours, expiresAt },
    });

    await this.redis.set(
      this.key(entityType, entityId, actionType),
      '1',
      'EX',
      cooldownHours * 3600,
    );
  }
}

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
    });

    // Soft-delete middleware: automatically filter out deleted records
    // on findMany, findFirst, findUnique for soft-deletable models.
    (this as PrismaClient).$use(async (params, next) => {
      const softDeleteModels = ['AdAccount', 'Campaign', 'AdSet'];

      if (softDeleteModels.includes(params.model ?? '')) {
        if (params.action === 'findUnique' || params.action === 'findFirst') {
          params.action = 'findFirst';
          params.args.where = { ...params.args.where, deletedAt: null };
        }
        if (params.action === 'findMany') {
          if (!params.args) params.args = {};
          if (!params.args.where) params.args.where = {};
          if (params.args.where.deletedAt === undefined) {
            params.args.where.deletedAt = null;
          }
        }
      }

      return next(params);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  // Explicit soft-delete helper to avoid raw update calls scattered across services
  async softDelete(
    model: 'adAccount' | 'campaign' | 'adSet',
    id: string,
  ): Promise<void> {
    await (this[model] as { update: (args: unknown) => Promise<unknown> }).update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

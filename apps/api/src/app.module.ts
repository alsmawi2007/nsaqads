import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AdAccountsModule } from './ad-accounts/ad-accounts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { MetricsModule } from './metrics/metrics.module';
import { ProvidersModule } from './providers/providers.module';
import { ProviderConfigsModule } from './provider-configs/provider-configs.module';
import { AdminModule } from './admin/admin.module';
import { OptimizerModule } from './optimizer/optimizer.module';
import { InsightsModule } from './insights/insights.module';
import { AlertsModule } from './alerts/alerts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { CampaignArchitectModule } from './campaign-architect/campaign-architect.module';
import { HistoricalLearningModule } from './historical-learning/historical-learning.module';
import { ActivationLabModule } from './activation-lab/activation-lab.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig, redisConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    RedisModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'single',
        url: `redis://:${config.get('redis.password')}@${config.get('redis.host')}:${config.get('redis.port')}`,
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    ProviderConfigsModule,
    ProvidersModule,
    AdAccountsModule,
    CampaignsModule,
    MetricsModule,
    AdminModule,
    OptimizerModule,
    InsightsModule,
    AlertsModule,
    DashboardModule,
    HealthModule,
    HistoricalLearningModule,
    CampaignArchitectModule,
    ActivationLabModule,
  ],
})
export class AppModule {}

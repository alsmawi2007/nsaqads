import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { OrgSettingsController } from './org-settings.controller';
import { AdminSettingsService } from './admin-settings.service';

@Module({
  controllers: [AdminController, OrgSettingsController],
  providers: [AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminModule {}

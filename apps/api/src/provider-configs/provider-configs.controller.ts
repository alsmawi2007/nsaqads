import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, Patch, Put, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Platform } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../common/guards/system-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProviderConfigsService } from './provider-configs.service';
import { UpsertProviderConfigDto } from './dto/upsert-provider-config.dto';

// SYSTEM_ADMIN-only surface for managing provider OAuth + API credentials.
// Mirrors the pattern of admin.controller.ts (JwtAuthGuard + SystemAdminGuard).
//
// All GET responses are redacted — never returns plaintext secrets.
@ApiTags('Admin — Provider Configs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/provider-configs')
export class ProviderConfigsController {
  constructor(private readonly service: ProviderConfigsService) {}

  @Get()
  @ApiOperation({ summary: 'List all provider configs (secrets redacted).' })
  list() {
    return this.service.listAllRedacted();
  }

  @Get(':platform')
  @ApiOperation({ summary: 'Get one provider config by platform (secrets redacted). Returns null if not configured.' })
  get(@Param('platform', new ParseEnumPipe(Platform)) platform: Platform) {
    return this.service.getRedacted(platform);
  }

  @Put(':platform')
  @ApiOperation({ summary: 'Create or update a provider config. On update, omitted secrets keep their existing value.' })
  upsert(
    @Param('platform', new ParseEnumPipe(Platform)) platform: Platform,
    @Body() dto: UpsertProviderConfigDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.upsert(platform, dto, user.sub);
  }

  @Patch(':platform/enabled')
  @ApiOperation({ summary: 'Toggle isEnabled without re-supplying secrets.' })
  setEnabled(
    @Param('platform', new ParseEnumPipe(Platform)) platform: Platform,
    @Body('isEnabled') isEnabled: boolean,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.setEnabled(platform, isEnabled, user.sub);
  }

  @Delete(':platform')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a provider config. Existing AdAccount tokens become unrefreshable.' })
  remove(
    @Param('platform', new ParseEnumPipe(Platform)) platform: Platform,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.delete(platform, user.sub);
  }
}

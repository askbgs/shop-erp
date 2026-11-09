import { BullModule } from '@nestjs/bullmq';
import { Body, Controller, Get, Global, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { NotificationChannel, NotificationStatus } from '../../generated/prisma/client';
import { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import { paged, PageQuery, paging } from '../../common/pagination';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { LK_PHONE, LK_PHONE_MSG } from '../auth/auth.dto';
import { NOTIFICATION_EVENTS, NotificationEvent } from './default-templates';
import { NOTIFICATION_QUEUE, NotificationsProcessor, NotificationsService } from './notifications.service';

class TemplateDto {
  @IsIn(Object.keys(NOTIFICATION_EVENTS)) event: NotificationEvent;
  @IsEnum(NotificationChannel) channel: NotificationChannel;
  @IsIn(['en', 'ta', 'si']) language: string;
  @IsString() @Length(1, 1000) body: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(1, 1000) body?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class TestDto {
  @IsIn(Object.keys(NOTIFICATION_EVENTS)) event: NotificationEvent;
  @Matches(LK_PHONE, { message: LK_PHONE_MSG }) to: string;
  @IsOptional() @IsIn(['en', 'ta', 'si']) language?: string;
}

class LogQuery extends PageQuery {
  @IsOptional() @IsEnum(NotificationStatus) status?: NotificationStatus;
  @IsOptional() @IsString() refId?: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@RequireFeature(FEATURES.NOTIFICATIONS)
@Controller('notifications')
class NotificationsController {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  @Get('events')
  events() {
    return Object.keys(NOTIFICATION_EVENTS);
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_MANAGE)
  templates(@CurrentUser() user: AuthUser) {
    return this.prisma.notificationTemplate.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ event: 'asc' }, { language: 'asc' }] });
  }

  /** Create or replace the template for an event + channel + language. */
  @Post('templates')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_MANAGE)
  upsert(@CurrentUser() user: AuthUser, @Body() dto: TemplateDto) {
    return this.prisma.notificationTemplate.upsert({
      where: { tenantId_event_channel_language: { tenantId: user.tenantId, event: dto.event, channel: dto.channel, language: dto.language } },
      create: { ...dto, tenantId: user.tenantId },
      update: { body: dto.body, isActive: dto.isActive ?? true },
    });
  }

  @Patch('templates/:id')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_MANAGE)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    await this.prisma.notificationTemplate.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.prisma.notificationTemplate.update({ where: { id }, data: dto });
  }

  @Get('logs')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_MANAGE)
  async logs(@CurrentUser() user: AuthUser, @Query() q: LogQuery) {
    const where = { tenantId: user.tenantId, status: q.status, refId: q.refId };
    const [items, total] = await Promise.all([
      this.prisma.notificationLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.notificationLog.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Send a sample message with dummy values to check a template and the provider. */
  @Post('test')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_MANAGE)
  async test(@CurrentUser() user: AuthUser, @Body() dto: TestDto) {
    await this.notifications.notify({
      tenantId: user.tenantId, event: dto.event, to: dto.to, language: dto.language,
      vars: { number: 'TEST-000001', device: 'iPhone 13', total: 'Rs. 1,000.00', amount: 'Rs. 1,000.00', balance: 'Rs. 0.00', estimate: 'Rs. 12,500.00', diagnosis: 'Screen damaged', status: 'In repair', trackUrl: 'https://example.com/track', warrantyUntil: '2026-12-31' },
      refType: 'Test',
    });
    return { queued: true };
  }
}

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}

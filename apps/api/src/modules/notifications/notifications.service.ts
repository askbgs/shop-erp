import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationEvent, renderTemplate } from './default-templates';

export const NOTIFICATION_QUEUE = 'notifications';

export interface NotifyInput {
  tenantId: string;
  event: NotificationEvent;
  /** +94 phone number (SMS / WhatsApp) */
  to: string | null | undefined;
  language?: string;
  vars: Record<string, string | number | null | undefined>;
  refType?: string;
  refId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService, @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue) {}

  /**
   * Renders the tenant's templates for this event and queues one message per channel.
   * Call it AFTER the business transaction commits; it never throws, so a messaging
   * problem cannot break a sale or a repair update.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      if (!input.to) return;
      const lang = input.language ?? 'en';
      let templates = await this.prisma.notificationTemplate.findMany({ where: { tenantId: input.tenantId, event: input.event, language: lang, isActive: true } });
      if (!templates.length && lang !== 'en') {
        templates = await this.prisma.notificationTemplate.findMany({ where: { tenantId: input.tenantId, event: input.event, language: 'en', isActive: true } });
      }
      if (!templates.length) return;
      const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } });
      const vars = { shop: tenant?.name, ...input.vars };

      for (const t of templates) {
        const log = await this.prisma.notificationLog.create({
          data: {
            tenantId: input.tenantId, event: input.event, channel: t.channel, to: input.to, body: renderTemplate(t.body, vars),
            refType: input.refType, refId: input.refId,
          },
        });
        await this.queue.add('send', { logId: log.id }, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
      }
    } catch (e) {
      this.logger.error(`Could not queue ${input.event} notification: ${(e as Error).message}`);
    }
  }
}

@Processor(NOTIFICATION_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    super();
  }

  async process(job: Job<{ logId: string }>): Promise<void> {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: job.data.logId } });
    if (!log || log.status === 'SENT') return;
    await this.prisma.notificationLog.update({ where: { id: log.id }, data: { attempts: { increment: 1 } } });

    if (this.config.get('NOTIFICATIONS_DRIVER') === 'log') {
      this.logger.log(`[${log.channel} → ${log.to}] ${log.body}`);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'SENT', sentAt: new Date() } });
      return;
    }

    const target =
      log.channel === 'SMS'
        ? { url: this.config.get<string>('SMS_GATEWAY_URL'), token: this.config.get<string>('SMS_GATEWAY_TOKEN') }
        : log.channel === 'WHATSAPP'
          ? { url: this.config.get<string>('WHATSAPP_WEBHOOK_URL'), token: this.config.get<string>('WHATSAPP_WEBHOOK_TOKEN') }
          : { url: undefined, token: undefined };

    if (!target.url) {
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'SKIPPED', error: `${log.channel} provider not configured` } });
      return;
    }

    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(target.token ? { authorization: `Bearer ${target.token}` } : {}) },
        body: JSON.stringify({ to: log.to, message: log.body, channel: log.channel, event: log.event, tenantId: log.tenantId, logId: log.id }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Provider answered ${res.status}`);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
    } catch (e) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: final ? 'FAILED' : 'QUEUED', error: (e as Error).message } });
      throw e; // let BullMQ retry
    }
  }
}

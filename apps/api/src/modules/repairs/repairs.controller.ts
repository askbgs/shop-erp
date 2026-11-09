import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RepairStatus } from '../../generated/prisma/client';
import { AuthUser, branchScope } from '../../common/auth-user';
import { CurrentUser, Public, RequireFeature, RequirePermissions } from '../../common/decorators';
import { formatLkr } from '../../common/money';
import { paged, paging } from '../../common/pagination';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { OPEN_STATUSES, STATUS_LABEL } from './repair-workflow';
import {
  AddPartDto, AssignDto, ChangeStatusDto, CreateRepairDto, DeliverDto, PhotoRegisterDto, PhotoUploadDto, RepairQuery, TrackQuery, UpdateRepairDto,
} from './repairs.dto';
import { RepairsService } from './repairs.service';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LIST_SELECT = {
  id: true, number: true, branchId: true, deviceBrand: true, deviceModel: true, imei: true, reportedFault: true, status: true,
  technicianId: true, estimateCents: true, totalCents: true, paidCents: true, promisedAt: true, createdAt: true, updatedAt: true,
  customer: { select: { id: true, name: true, phone: true } },
} as const;

@ApiTags('Repairs')
@ApiBearerAuth()
@RequireFeature(FEATURES.REPAIRS)
@Controller('repairs')
export class RepairsController {
  constructor(private readonly prisma: PrismaService, private readonly repairs: RepairsService, private readonly config: ConfigService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.REPAIR_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRepairDto) {
    return this.repairs.create(user, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  async list(@CurrentUser() user: AuthUser, @Query() q: RepairQuery) {
    const where = {
      tenantId: user.tenantId,
      ...branchScope(user, q.branchId),
      technicianId: q.technicianId,
      customerId: q.customerId,
      status: q.status ?? (q.state === 'open' ? { in: OPEN_STATUSES.concat(['REJECTED', 'NOT_REPAIRABLE']) as RepairStatus[] } : q.state === 'closed' ? { in: ['DELIVERED', 'CANCELLED'] as RepairStatus[] } : undefined),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' as const } },
              { imei: { contains: q.q } },
              { deviceModel: { contains: q.q, mode: 'insensitive' as const } },
              { customer: { phone: { contains: q.q } } },
              { customer: { name: { contains: q.q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.repairJob.findMany({ where, select: LIST_SELECT, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.repairJob.count({ where }),
      this.prisma.repairJob.groupBy({ by: ['status'], where: { tenantId: user.tenantId, ...branchScope(user, q.branchId) }, _count: true }),
    ]);
    return { ...paged(items, total, q), byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])) };
  }

  /** The signed-in technician's open jobs, oldest promise first. */
  @Get('my-queue')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  myQueue(@CurrentUser() user: AuthUser) {
    return this.prisma.repairJob.findMany({
      where: { tenantId: user.tenantId, technicianId: user.userId, status: { in: OPEN_STATUSES } },
      select: LIST_SELECT,
      orderBy: [{ promisedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.repairs.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.REPAIR_UPDATE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRepairDto) {
    return this.repairs.update(user, id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.REPAIR_UPDATE)
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeStatusDto) {
    return this.repairs.changeStatus(user, id, dto.status, dto.note);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.REPAIR_ASSIGN)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.repairs.assign(user, id, dto.technicianId);
  }

  @Post(':id/parts')
  @RequirePermissions(PERMISSIONS.REPAIR_UPDATE)
  addPart(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPartDto) {
    return this.repairs.addPart(user, id, dto);
  }

  @Delete(':id/parts/:partId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.REPAIR_UPDATE)
  removePart(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('partId', ParseUUIDPipe) partId: string) {
    return this.repairs.removePart(user, id, partId);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.REPAIR_DELIVER)
  deliver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto) {
    return this.repairs.deliver(user, id, dto);
  }

  @Get(':id/passcode')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  passcode(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.repairs.passcode(user, id);
  }

  /** Step 1 of a photo upload: get a presigned R2 URL, PUT the image there from the browser/app. */
  @Post(':id/photos/upload-url')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  uploadUrl(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoUploadDto) {
    return this.repairs.photoUploadUrl(user, id, dto.contentType);
  }

  /** Step 2: register the uploaded key on the job. */
  @Post(':id/photos')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  addPhoto(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoRegisterDto) {
    return this.repairs.addPhoto(user, id, dto.key, dto.caption, dto.stage);
  }

  /** Printable job card with terms and signature lines (A5 / 80 mm). */
  @Get(':id/job-card')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  @Header('content-type', 'text/html; charset=utf-8')
  @ApiProduces('text/html')
  async jobCard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.repairs.get(user, id);
    const [branch, tenant, settings] = await Promise.all([
      this.prisma.branch.findUniqueOrThrow({ where: { id: job.branchId } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
      this.prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } }),
    ]);
    const tz = this.config.get<string>('APP_TIMEZONE');
    const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d) : '—');
    const trackUrl = `${this.config.get('PUBLIC_TRACKING_URL')}?code=${job.trackCode}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(job.number)}</title>
<style>body{font-family:system-ui,sans-serif;font-size:12px;max-width:148mm;margin:6mm auto}h1{font-size:16px;margin:0}table{width:100%;border-collapse:collapse}
td{padding:3px 4px;border-bottom:1px solid #ddd;vertical-align:top}td:first-child{width:35%;color:#555}.num{font-size:20px;font-weight:700;text-align:right}
.terms{font-size:10px;color:#444;margin-top:8px}.sig{display:flex;gap:24px;margin-top:28px}.sig div{flex:1;border-top:1px solid #000;padding-top:3px;text-align:center}
@media print{button{display:none}}</style></head><body>
<table><tr><td style="border:0"><h1>${esc(tenant.name)}</h1>${esc(branch.name)}${branch.phone ? ` · ${esc(branch.phone)}` : ''}</td><td class="num" style="border:0">${esc(job.number)}</td></tr></table>
<h3>Repair job card</h3><table>
<tr><td>Received</td><td>${esc(fmt(job.createdAt))}</td></tr>
<tr><td>Customer</td><td>${esc(job.customer.name)} · ${esc(job.customer.phone)}</td></tr>
<tr><td>Device</td><td>${esc([job.deviceBrand, job.deviceModel, job.color].filter(Boolean).join(' '))}</td></tr>
<tr><td>IMEI / Serial</td><td>${esc(job.imei ?? job.serial ?? '—')}</td></tr>
<tr><td>Fault reported</td><td>${esc(job.reportedFault)}</td></tr>
<tr><td>Accessories received</td><td>${esc(job.accessories.join(', ') || 'None')}</td></tr>
<tr><td>Condition</td><td>${esc(job.conditionNotes ?? '—')}${job.powersOn === false ? ' · Does not power on' : ''}</td></tr>
<tr><td>Passcode given</td><td>${job.hasPasscode ? 'Yes (stored encrypted)' : 'No'}</td></tr>
<tr><td>Estimate</td><td>${job.estimateCents ? formatLkr(job.estimateCents) : 'After diagnosis'}</td></tr>
<tr><td>Advance paid</td><td>${formatLkr(job.paidCents)}</td></tr>
<tr><td>Promised</td><td>${esc(fmt(job.promisedAt))}</td></tr>
<tr><td>Status</td><td>${esc(STATUS_LABEL[job.status])}</td></tr>
<tr><td>Tracking code</td><td><b style="font-size:15px;letter-spacing:1px">${esc(job.trackCode)}</b></td></tr>
<tr><td>Track online</td><td>${esc(trackUrl)}</td></tr></table>
<div class="terms">${esc(settings.repairTerms)}</div>
<div class="sig"><div>Customer signature</div><div>Received by</div></div>
<button onclick="window.print()">Print</button></body></html>`;
  }
}

/** Customer-facing tracking page backend (no login). */
@ApiTags('Public')
@Public()
@Controller('public/repairs')
export class PublicRepairsController {
  constructor(private readonly repairs: RepairsService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('track')
  track(@Query() q: TrackQuery) {
    return this.repairs.track(q.code, q.phone);
  }
}

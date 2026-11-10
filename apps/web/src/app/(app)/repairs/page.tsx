'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge, ButtonLink, cx, Input, Loading, PageHeader, Pager, Panel, Table } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { dateTime, daysAgo, lkr } from '@/lib/format';
import { useSession } from '@/lib/session';
import { REPAIR_LABEL, RepairJob, RepairStatus, repairTone } from '@/lib/types';

const FILTERS: { key: string; label: string; statuses?: RepairStatus[] }[] = [
  { key: 'open', label: 'In the shop' },
  { key: 'WAITING_APPROVAL', label: 'Waiting for approval', statuses: ['WAITING_APPROVAL'] },
  { key: 'WAITING_PARTS', label: 'Waiting for parts', statuses: ['WAITING_PARTS'] },
  { key: 'READY', label: 'Ready for pickup', statuses: ['READY'] },
  { key: 'closed', label: 'Delivered & cancelled' },
];

function RepairsList() {
  const { branchId, can, me } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const filter = params.get('status') ?? 'open';
  const mine = params.get('mine') === '1';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const isState = filter === 'open' || filter === 'closed';
  const list = useQuery({
    queryKey: ['repairs', branchId, filter, q, page, mine],
    queryFn: () =>
      api.get<Paged<RepairJob> & { byStatus: Partial<Record<RepairStatus, number>> }>(
        `/repairs${qs({ branchId, ...(isState ? { state: filter } : { status: filter }), technicianId: mine ? me.id : undefined, q, page, pageSize: 30 })}`,
      ),
  });
  const counts = list.data?.byStatus ?? {};

  return (
    <>
      <PageHeader
        title="Repairs"
        sub="Every device in for service at this branch"
        actions={
          <>
            {me.isTechnician && <ButtonLink href={mine ? '/repairs?status=open' : '/repairs?status=open&mine=1'}>{mine ? 'All jobs' : 'My jobs'}</ButtonLink>}
            {can('repair.create') && <ButtonLink href="/repairs/new" variant="primary">Take in a device</ButtonLink>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = f.statuses ? f.statuses.reduce((a, s) => a + (counts[s] ?? 0), 0) : undefined;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { setPage(1); router.replace(`/repairs?status=${f.key}`); }}
              className={cx('h-9 rounded-full border px-4 text-sm font-semibold transition-colors', filter === f.key ? 'border-solder bg-solder-tint text-solder-2' : 'border-line bg-surface text-ink-2')}
            >
              {f.label}
              {n ? <span className="num ml-2 rounded bg-led px-1.5 text-white">{n}</span> : null}
            </button>
          );
        })}
        <div className="ml-auto w-full sm:w-72">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Job number, IMEI, phone or name" aria-label="Search repairs" />
        </div>
      </div>
      <Panel pad={false}>
        {!list.data ? (
          <Loading />
        ) : (
          <>
            <Table head={['Job', 'Device', 'Customer', 'Status', 'Promised', 'Bill']} empty={filter === 'open' ? 'No devices in the shop right now.' : 'No jobs match.'}>
              {list.data.items.map((j) => (
                <tr key={j.id} className="cursor-pointer hover:bg-canvas" onClick={() => router.push(`/repairs/${j.id}`)}>
                  <td>
                    <Link href={`/repairs/${j.id}`} className="code font-bold text-solder">{j.number}</Link>
                    <div className="text-xs text-ink-3">{daysAgo(j.createdAt) === 0 ? 'Today' : `${daysAgo(j.createdAt)} days ago`}</div>
                  </td>
                  <td>
                    <div className="font-semibold">{[j.deviceBrand, j.deviceModel].filter(Boolean).join(' ')}</div>
                    <div className="max-w-64 truncate text-xs text-ink-3">{j.reportedFault}</div>
                  </td>
                  <td>
                    <div>{j.customer.name}</div>
                    <div className="text-xs text-ink-3">{j.customer.phone}</div>
                  </td>
                  <td><Badge tone={repairTone(j.status)}>{REPAIR_LABEL[j.status]}</Badge></td>
                  <td className={cx('whitespace-nowrap', j.promisedAt && new Date(j.promisedAt) < new Date() && !['DELIVERED', 'CANCELLED'].includes(j.status) && 'font-semibold text-fault')}>{dateTime(j.promisedAt)}</td>
                  <td className="num whitespace-nowrap">{j.totalCents ? lkr(j.totalCents) : j.estimateCents ? `est. ${lkr(j.estimateCents)}` : '—'}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={30} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

export default function RepairsPage() {
  return (
    <Suspense>
      <RepairsList />
    </Suspense>
  );
}

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, cx, Field, Input, Loading, Modal, PageHeader, Panel, Select, Table, Textarea } from '@/components/ui';
import { api, Paged } from '@/lib/api';
import { date, DISTRICTS, lkr, toLkPhone } from '@/lib/format';
import { useSession } from '@/lib/session';

const TABS = [
  { key: 'shop', label: 'Shop', perm: 'tenant.manage' },
  { key: 'staff', label: 'Staff', perm: 'user.read' },
  { key: 'branches', label: 'Branches', perm: 'branch.manage' },
  { key: 'messages', label: 'Customer messages', perm: 'notification.manage' },
  { key: 'plan', label: 'Plan', perm: 'user.read' },
];

export default function SettingsPage() {
  const { can } = useSession();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState(tabs[0]?.key ?? 'plan');
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
            className={cx('h-9 rounded-ctl border px-3 text-sm font-semibold', tab === t.key ? 'border-solder bg-solder-tint text-solder-2' : 'border-line bg-surface text-ink-2')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'shop' && <ShopSettings />}
      {tab === 'staff' && <Staff />}
      {tab === 'branches' && <Branches />}
      {tab === 'messages' && <Messages />}
      {tab === 'plan' && <Plan />}
    </>
  );
}

interface Settings {
  vatRateBp: number;
  pricesIncludeVat: boolean;
  allowNegativeStock: boolean;
  defaultWarrantyDays: number;
  repairWarrantyDays: number;
  repairTerms: string;
  receiptWidthMm: number;
  loyaltyEarnCentsPerPt: number;
  loyaltyPointValueCents: number;
}

function ShopSettings() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/tenant/settings') });
  const [f, setF] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  if (!f) return <Loading />;
  async function save() {
    setMsg(null);
    try {
      const { vatRateBp, pricesIncludeVat, allowNegativeStock, defaultWarrantyDays, repairWarrantyDays, repairTerms, receiptWidthMm, loyaltyEarnCentsPerPt, loyaltyPointValueCents } = f!;
      await api.patch('/tenant/settings', { vatRateBp, pricesIncludeVat, allowNegativeStock, defaultWarrantyDays, repairWarrantyDays, repairTerms, receiptWidthMm, loyaltyEarnCentsPerPt, loyaltyPointValueCents });
      qc.invalidateQueries({ queryKey: ['settings'] });
      setMsg({ tone: 'good', text: 'Settings saved.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message });
    }
  }
  const n = (k: keyof Settings) => (e: { target: { value: string } }) => setF({ ...f!, [k]: Number(e.target.value) || 0 });
  return (
    <div className="max-w-3xl space-y-6">
      <Panel title="Tax and pricing">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="VAT rate (%)"><Input type="number" step="0.01" className="num" value={f.vatRateBp / 100} onChange={(e) => setF({ ...f, vatRateBp: Math.round(Number(e.target.value) * 100) })} /></Field>
          <Field label="Shelf prices">
            <Select value={f.pricesIncludeVat ? 'incl' : 'excl'} onChange={(e) => setF({ ...f, pricesIncludeVat: e.target.value === 'incl' })}>
              <option value="incl">Include VAT</option>
              <option value="excl">Exclude VAT</option>
            </Select>
          </Field>
          <Field label="Receipt paper">
            <Select value={f.receiptWidthMm} onChange={n('receiptWidthMm')}>
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </Select>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-solder" checked={f.allowNegativeStock} onChange={(e) => setF({ ...f, allowNegativeStock: e.target.checked })} />
          Allow selling counted items when the system shows none left
        </label>
      </Panel>
      <Panel title="Warranty and repairs">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default warranty on devices (days)"><Input type="number" className="num" value={f.defaultWarrantyDays} onChange={n('defaultWarrantyDays')} /></Field>
          <Field label="Warranty on repairs (days)"><Input type="number" className="num" value={f.repairWarrantyDays} onChange={n('repairWarrantyDays')} /></Field>
        </div>
        <Field label="Terms printed on the job card" className="mt-3"><Textarea value={f.repairTerms} onChange={(e) => setF({ ...f, repairTerms: e.target.value })} /></Field>
      </Panel>
      <Panel title="Loyalty points">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customers earn 1 point for every (Rs)"><Input type="number" className="num" value={f.loyaltyEarnCentsPerPt / 100} onChange={(e) => setF({ ...f, loyaltyEarnCentsPerPt: Math.round(Number(e.target.value) * 100) || 1 })} /></Field>
          <Field label="1 point is worth (Rs)"><Input type="number" step="0.01" className="num" value={f.loyaltyPointValueCents / 100} onChange={(e) => setF({ ...f, loyaltyPointValueCents: Math.round(Number(e.target.value) * 100) })} /></Field>
        </div>
      </Panel>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex justify-end"><Button variant="primary" onClick={save}>Save settings</Button></div>
    </div>
  );
}

interface User { id: string; name: string; email: string; phone: string | null; isActive: boolean; isTechnician: boolean; lastLoginAt: string | null; role: { id: string; name: string }; branches: { branchId: string }[] }
interface Role { id: string; name: string; maxDiscountBp: number; _count: { users: number } }

function Staff() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<Paged<User>>('/users?pageSize=200') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', roleId: '', pin: '', isTechnician: false, branchIds: [] as string[] });
  const [error, setError] = useState('');
  async function create() {
    setError('');
    try {
      await api.post('/users', { ...f, phone: f.phone ? toLkPhone(f.phone) : undefined, pin: f.pin || undefined });
      qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggle(u: User) {
    await api.patch(`/users/${u.id}`, { isActive: !u.isActive }).catch((e) => alertError(e));
    qc.invalidateQueries({ queryKey: ['users'] });
  }
  function alertError(e: Error) { setError(e.message); }
  const branchName = (id: string) => me.branches.find((b) => b.id === id)?.code ?? '';
  return (
    <Panel title="Staff" actions={can('user.manage') && <Button size="sm" variant="primary" onClick={() => { setOpen(true); setF({ name: '', email: '', phone: '', password: '', roleId: roles.data?.find((r) => r.name === 'Cashier')?.id ?? '', pin: '', isTechnician: false, branchIds: me.branches.map((b) => b.id) }); }}>Add staff member</Button>} pad={false}>
      {error && !open && <div className="p-3"><Alert>{error}</Alert></div>}
      {!users.data ? <Loading /> : (
        <Table head={['Name', 'Role', 'Branches', 'Last sign-in', '']}>
          {users.data.items.map((u) => (
            <tr key={u.id} className={u.isActive ? '' : 'opacity-60'}>
              <td><div className="font-semibold">{u.name}{u.isTechnician && <span className="ml-2"><Badge tone="info">Technician</Badge></span>}</div><div className="text-xs text-ink-3">{u.email}</div></td>
              <td>{u.role.name}</td>
              <td className="code text-ink-2">{u.role.name === 'Owner' ? 'All' : u.branches.map((b) => branchName(b.branchId)).join(', ')}</td>
              <td className="text-ink-3">{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</td>
              <td className="text-right">{can('user.manage') && u.id !== me.id && <button type="button" className="text-sm font-semibold text-solder underline" onClick={() => toggle(u)}>{u.isActive ? 'Deactivate' : 'Reactivate'}</button>}</td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} title="Add a staff member" onClose={() => setOpen(false)} wide footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create} disabled={!f.name || !f.email || f.password.length < 8 || !f.roleId}>Add staff member</Button></>}>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
            <Field label="Email (used to sign in)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Mobile"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Password" hint="At least 8 characters"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
            <Field label="Role">
              <Select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
                <option value="">Choose…</option>
                {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}{r.maxDiscountBp ? ` (discount up to ${r.maxDiscountBp / 100}%)` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Quick-switch PIN" hint="4 to 6 digits, for shared counters"><Input inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink-2">Works at</legend>
            <div className="flex flex-wrap gap-3">
              {me.branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-solder" checked={f.branchIds.includes(b.id)} onChange={(e) => setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id) })} />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-solder" checked={f.isTechnician} onChange={(e) => setF({ ...f, isTechnician: e.target.checked })} />
            Repairs devices (can be assigned repair jobs)
          </label>
        </div>
      </Modal>
    </Panel>
  );
}

interface Branch { id: string; code: string; name: string; address: string | null; district: string | null; phone: string | null; vatNumber: string | null; isActive: boolean }

function Branches() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/branches') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', address: '', district: '', phone: '', vatNumber: '' });
  const [error, setError] = useState('');
  async function create() {
    setError('');
    try {
      await api.post('/branches', { ...f, code: f.code.toUpperCase(), address: f.address || undefined, district: f.district || undefined, phone: f.phone ? toLkPhone(f.phone) : undefined, vatNumber: f.vatNumber || undefined });
      await api.auth('refresh'); // branch access is carried in the session
      qc.invalidateQueries();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Panel title="Branches" actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add a branch</Button>} pad={false}>
      {!list.data ? <Loading /> : (
        <Table head={['Code', 'Name', 'District', 'Phone', 'VAT number']}>
          {list.data.map((b) => (
            <tr key={b.id}>
              <td className="code font-bold">{b.code}</td>
              <td>{b.name}</td>
              <td>{b.district ?? '—'}</td>
              <td>{b.phone ?? '—'}</td>
              <td className="code">{b.vatNumber ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} title="Add a branch" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create} disabled={!f.code || !f.name}>Add branch</Button></>}>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <Field label="Code" hint="On invoice numbers"><Input maxLength={5} className="code uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          </div>
          <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="District">
              <Select value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })}>
                <option value="">—</option>
                {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Field label="VAT registration number"><Input className="code" value={f.vatNumber} onChange={(e) => setF({ ...f, vatNumber: e.target.value })} /></Field>
        </div>
      </Modal>
    </Panel>
  );
}

interface Template { id: string; event: string; channel: string; language: string; body: string; isActive: boolean }
const EVENT_LABEL: Record<string, string> = {
  INVOICE_ISSUED: 'After a sale', PAYMENT_RECEIVED: 'Payment received', JOB_RECEIVED: 'Device received for repair', JOB_ESTIMATE: 'Repair estimate',
  JOB_STATUS: 'Repair status changed', JOB_READY: 'Repair ready for pickup', JOB_DELIVERED: 'Repair handed over',
};
const LANG = { en: 'English', ta: 'Tamil', si: 'Sinhala' } as Record<string, string>;

function Messages() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/notifications/templates') });
  const [edit, setEdit] = useState<Template | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      await api.patch(`/notifications/templates/${edit!.id}`, { body });
      qc.invalidateQueries({ queryKey: ['templates'] });
      setEdit(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggle(t: Template) {
    await api.patch(`/notifications/templates/${t.id}`, { isActive: !t.isActive });
    qc.invalidateQueries({ queryKey: ['templates'] });
  }
  return (
    <Panel title="Messages sent to customers" pad={false}>
      <p className="border-b border-line-2 px-4 py-3 text-sm text-ink-2">
        Words in double braces are filled in automatically, for example {'{{number}}'} becomes the job or invoice number.
      </p>
      {!list.data ? <Loading /> : (
        <Table head={['When', 'Channel', 'Language', 'Message', '']}>
          {list.data.map((t) => (
            <tr key={t.id} className={t.isActive ? '' : 'opacity-60'}>
              <td className="font-semibold whitespace-nowrap">{EVENT_LABEL[t.event] ?? t.event}</td>
              <td>{t.channel === 'WHATSAPP' ? 'WhatsApp' : t.channel}</td>
              <td>{LANG[t.language] ?? t.language}</td>
              <td className="max-w-md text-ink-2">{t.body}</td>
              <td className="whitespace-nowrap text-right">
                <button type="button" className="mr-3 text-sm font-semibold text-solder underline" onClick={() => { setEdit(t); setBody(t.body); }}>Edit</button>
                <button type="button" className="text-sm font-semibold text-ink-3 underline" onClick={() => toggle(t)}>{t.isActive ? 'Turn off' : 'Turn on'}</button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} title={edit ? EVENT_LABEL[edit.event] : ''} onClose={() => setEdit(null)} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save message</Button></>}>
        <Alert>{error}</Alert>
        <Field label="Message"><Textarea className="min-h-32" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      </Modal>
    </Panel>
  );
}

function Plan() {
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api.get<{ status: string; plan: { name: string; priceCents: number; maxUsers: number }; currentPeriodEnd: string; activeBranches: number; monthlyCents: number; invoices: { id: string; amountCents: number; status: string; periodStart: string; periodEnd: string }[] }>('/tenant/subscription') });
  if (!sub.data) return <Loading />;
  const s = sub.data;
  return (
    <div className="max-w-2xl space-y-6">
      <Panel title={s.plan.name}>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-ink-3">Status</dt><dd><Badge tone={s.status === 'ACTIVE' ? 'good' : s.status === 'TRIALING' ? 'info' : 'bad'}>{s.status === 'TRIALING' ? 'Free trial' : s.status.toLowerCase()}</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-ink-3">{s.status === 'TRIALING' ? 'Trial ends' : 'Paid until'}</dt><dd>{date(s.currentPeriodEnd)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-3">Branches</dt><dd className="num">{s.activeBranches}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-3">Staff accounts allowed</dt><dd className="num">{s.plan.maxUsers}</dd></div>
          <div className="flex justify-between font-bold"><dt>Monthly fee</dt><dd className="num">{lkr(s.monthlyCents)}</dd></div>
        </dl>
      </Panel>
      <Panel title="Subscription invoices" pad={false}>
        <Table head={['Period', 'Amount', 'Status']} empty="No invoices yet.">
          {s.invoices.map((i) => (
            <tr key={i.id}><td>{date(i.periodStart)} to {date(i.periodEnd)}</td><td className="num">{lkr(i.amountCents)}</td><td><Badge tone={i.status === 'PAID' ? 'good' : 'wait'}>{i.status.toLowerCase()}</Badge></td></tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

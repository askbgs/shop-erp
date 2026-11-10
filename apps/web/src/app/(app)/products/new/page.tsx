'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { PhotoItem, PhotoPicker } from '@/components/product-images';
import { Alert, Button, Field, Input, PageHeader, Panel, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { toCents } from '@/lib/format';
import { uploadProductImage } from '@/lib/image';
import { Product } from '@/lib/types';

interface VariantRow {
  name: string;
  sku: string;
  barcode: string;
  price: string;
  minPrice: string;
  reorder: string;
}

const blank = (): VariantRow => ({ name: '', sku: '', barcode: '', price: '', minPrice: '', reorder: '' });

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ id: string; name: string }[]>('/catalog/categories') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<{ id: string; name: string }[]>('/catalog/brands') });
  const [f, setF] = useState({ name: '', model: '', categoryId: '', brandId: '', trackingType: 'SERIAL', hasDualImei: true, warrantyDays: '365' });
  const [variants, setVariants] = useState<VariantRow[]>([blank()]);
  const [newBrand, setNewBrand] = useState('');
  const [newCat, setNewCat] = useState('');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function addRef(kind: 'brands' | 'categories', name: string) {
    const r = await api.post<{ id: string }>(`/catalog/${kind}`, { name });
    await qc.invalidateQueries({ queryKey: [kind] });
    return r.id;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const brandId = newBrand ? await addRef('brands', newBrand) : f.brandId || undefined;
      const categoryId = newCat ? await addRef('categories', newCat) : f.categoryId || undefined;
      const p = await api.post<Product>('/catalog/products', {
        name: f.name,
        model: f.model || undefined,
        brandId,
        categoryId,
        trackingType: f.trackingType,
        hasDualImei: f.trackingType === 'SERIAL' && f.hasDualImei,
        warrantyDays: f.warrantyDays ? Number(f.warrantyDays) : undefined,
        variants: variants.map((v) => ({
          name: v.name || 'Standard',
          sku: v.sku,
          barcode: v.barcode || undefined,
          priceCents: toCents(v.price) ?? 0,
          minPriceCents: toCents(v.minPrice) ?? undefined,
          reorderLevel: v.reorder ? Number(v.reorder) : undefined,
        })),
      });
      // Photos upload after the product exists; one failed photo does not lose the product.
      let failed = 0;
      for (const [n, ph] of photos.entries()) {
        setProgress(`Uploading photo ${n + 1} of ${photos.length}…`);
        try {
          await uploadProductImage(p.id, ph.blob!);
        } catch {
          failed++;
        }
      }
      photos.forEach((ph) => URL.revokeObjectURL(ph.url));
      router.replace(`/products/${p.id}${failed ? `?photosFailed=${failed}` : ''}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setProgress('');
    }
  }

  const setV = (i: number, k: keyof VariantRow, v: string) => setVariants(variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <form onSubmit={submit}>
      <PageHeader title="Add a product" />
      <div className="space-y-6">
        <Panel title="Product">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="iPhone 13" autoFocus /></Field>
            <Field label="Model number"><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="A2633" /></Field>
            <Field label="Brand">
              <div className="flex gap-2">
                <Select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })} disabled={!!newBrand}>
                  <option value="">No brand</option>
                  {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
                <Input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} placeholder="or new brand" aria-label="New brand" />
              </div>
            </Field>
            <Field label="Category">
              <div className="flex gap-2">
                <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} disabled={!!newCat}>
                  <option value="">No category</option>
                  {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="or new category" aria-label="New category" />
              </div>
            </Field>
            <Field label="How is it tracked?" hint={f.trackingType === 'SERIAL' ? 'Each unit is received and sold by its IMEI or serial number' : f.trackingType === 'QUANTITY' ? 'Counted by quantity, e.g. covers and cables' : 'No stock, e.g. software installation'}>
              <Select value={f.trackingType} onChange={(e) => setF({ ...f, trackingType: e.target.value })}>
                <option value="SERIAL">By IMEI or serial number</option>
                <option value="QUANTITY">By quantity</option>
                <option value="SERVICE">Service (no stock)</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Warranty (days)"><Input type="number" min={0} className="num" value={f.warrantyDays} onChange={(e) => setF({ ...f, warrantyDays: e.target.value })} /></Field>
              {f.trackingType === 'SERIAL' && (
                <label className="flex items-center gap-2 pt-6 text-sm font-semibold">
                  <input type="checkbox" className="size-4 accent-solder" checked={f.hasDualImei} onChange={(e) => setF({ ...f, hasDualImei: e.target.checked })} />
                  Phone with IMEI numbers
                </label>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Photos">
          <PhotoPicker
            items={photos}
            onAdd={(added) => setPhotos((ps) => [...ps, ...added.map((a, n) => ({ key: `${Date.now()}-${n}`, url: a.url, blob: a.blob }))])}
            onRemove={(key) => setPhotos((ps) => { const gone = ps.find((x) => x.key === key); if (gone) URL.revokeObjectURL(gone.url); return ps.filter((x) => x.key !== key); })}
            onCover={(key) => setPhotos((ps) => [ps.find((x) => x.key === key)!, ...ps.filter((x) => x.key !== key)])}
            disabled={busy}
          />
          <p className="mt-3 text-sm text-ink-3">The cover photo shows in the product list and at the point of sale. Photos are resized to save data.</p>
        </Panel>

        <Panel title="Options and prices" actions={<Button size="sm" onClick={() => setVariants([...variants, blank()])}>Add an option</Button>}>
          <p className="mb-3 text-sm text-ink-2">One row per storage size, colour or model that has its own price.</p>
          <div className="space-y-3">
            {variants.map((v, i) => (
              <div key={i} className="grid gap-2 rounded-ctl border border-line-2 p-3 md:grid-cols-6">
                <Field label="Option" className="md:col-span-2"><Input value={v.name} onChange={(e) => setV(i, 'name', e.target.value)} placeholder="128GB Midnight" /></Field>
                <Field label="SKU"><Input required value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value)} className="code" /></Field>
                <Field label="Price (Rs)"><Input required inputMode="decimal" className="num" value={v.price} onChange={(e) => setV(i, 'price', e.target.value)} /></Field>
                <Field label="Lowest price (Rs)" hint="Below this needs a manager"><Input inputMode="decimal" className="num" value={v.minPrice} onChange={(e) => setV(i, 'minPrice', e.target.value)} /></Field>
                <Field label="Reorder at"><Input type="number" min={0} className="num" value={v.reorder} onChange={(e) => setV(i, 'reorder', e.target.value)} /></Field>
                <Field label="Barcode" className="md:col-span-2"><Input value={v.barcode} onChange={(e) => setV(i, 'barcode', e.target.value)} className="code" /></Field>
                {variants.length > 1 && <div className="flex items-end md:col-span-4 md:justify-end"><Button size="sm" variant="ghost" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>Remove option</Button></div>}
              </div>
            ))}
          </div>
        </Panel>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
          {progress && <span className="self-center text-sm text-ink-2" role="status">{progress}</span>}
          <Button type="submit" variant="primary" size="lg" loading={busy}>Save product</Button>
        </div>
      </div>
    </form>
  );
}

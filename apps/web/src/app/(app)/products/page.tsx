'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ProductThumb } from '@/components/product-images';
import { Badge, ButtonLink, Input, Loading, PageHeader, Pager, Panel, Table } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { lkr } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Product, TRACKING_LABEL } from '@/lib/types';

export default function ProductsPage() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['products', q, page], queryFn: () => api.get<Paged<Product>>(`/catalog/products${qs({ q, page, pageSize: 50 })}`) });
  return (
    <>
      <PageHeader title="Products" sub="Everything you sell: phones, laptops, accessories, spare parts and services" actions={can('catalog.manage') && <ButtonLink href="/products/new" variant="primary">Add a product</ButtonLink>} />
      <Panel pad={false}>
        <div className="border-b border-line-2 p-3">
          <Input className="max-w-sm" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, model, SKU or barcode" aria-label="Search products" />
        </div>
        {!list.data ? <Loading /> : (
          <>
            <Table head={['Product', 'Brand', 'Tracked by', 'Options', 'Price']} empty="No products yet. Add the phones and accessories you sell.">
              {list.data.items.map((p) => {
                const prices = p.variants.map((v) => v.priceCents);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/products/${p.id}`} className="flex items-center gap-3">
                        <ProductThumb url={p.images?.[0]?.url} size={44} />
                        <span><span className="block font-semibold text-solder">{p.name}</span>{p.model && <span className="block text-xs text-ink-3">{p.model}</span>}</span>
                      </Link>
                    </td>
                    <td>{p.brand?.name ?? '—'}</td>
                    <td><Badge tone={p.trackingType === 'SERIAL' ? 'info' : 'neutral'}>{TRACKING_LABEL[p.trackingType]}</Badge></td>
                    <td className="text-ink-2">{p.variants.map((v) => v.name).join(', ')}</td>
                    <td className="num whitespace-nowrap">{prices.length ? (Math.min(...prices) === Math.max(...prices) ? lkr(prices[0]) : `${lkr(Math.min(...prices))} to ${lkr(Math.max(...prices))}`) : '—'}</td>
                  </tr>
                );
              })}
            </Table>
            <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

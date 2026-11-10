'use client';

import { ImagePlus, Package, Star, Trash2 } from 'lucide-react';
import { ClipboardEvent, DragEvent, useRef, useState } from 'react';
import { ACCEPT, shrinkImage } from '@/lib/image';
import { Alert, cx } from './ui';

export const MAX_PHOTOS = 4;

/** Small square product photo, or a neutral placeholder when there is none. */
export function ProductThumb({ url, alt = '', size = 40, className }: { url?: string | null; alt?: string; size?: number; className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center overflow-hidden rounded-[10px] border border-line-2 bg-canvas', className)} style={{ width: size, height: size }}>
      {url ? <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" /> : <Package className="text-ink-3/60" style={{ width: size * 0.45, height: size * 0.45 }} aria-hidden />}
    </span>
  );
}

export interface PhotoItem {
  key: string;
  url: string; // object URL (local) or server URL
  blob?: Blob; // present for photos not uploaded yet
}

/**
 * Photo picker: drop, browse or paste images. Photos are shrunk in the browser before upload.
 * The first photo is the cover. Works for local photos (new product) and saved ones (product page).
 */
export function PhotoPicker({
  items, onAdd, onRemove, onCover, busy, max = MAX_PHOTOS, disabled,
}: {
  items: PhotoItem[];
  onAdd: (photos: { blob: Blob; url: string }[]) => void | Promise<void>;
  onRemove: (key: string) => void | Promise<void>;
  onCover: (key: string) => void | Promise<void>;
  busy?: string | null;
  max?: number;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const room = max - items.length;

  async function take(files: File[]) {
    setError('');
    if (!files.length) return;
    if (files.length > room) setError(`Only ${room} more photo${room === 1 ? '' : 's'} can be added (up to ${max}).`);
    const out: { blob: Blob; url: string }[] = [];
    for (const f of files.slice(0, Math.max(room, 0))) {
      try {
        const blob = await shrinkImage(f);
        out.push({ blob, url: URL.createObjectURL(blob) });
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (out.length) await onAdd(out);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (!disabled) take(Array.from(e.dataTransfer.files));
  }

  function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length && !disabled) {
      e.preventDefault();
      take(files);
    }
  }

  return (
    <div onPaste={onPaste}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((p, n) => (
          <figure key={p.key} className={cx('group relative aspect-square overflow-hidden rounded-[14px] border bg-canvas', n === 0 ? 'border-solder ring-2 ring-solder/20' : 'border-line')}>
            <img src={p.url} alt={n === 0 ? 'Cover photo' : `Photo ${n + 1}`} className="h-full w-full object-cover" />
            {n === 0 && <figcaption className="absolute top-2 left-2 rounded-full bg-solder px-2 py-0.5 text-xs font-bold text-white">Cover</figcaption>}
            {!disabled && (
              <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                {n > 0 && (
                  <button type="button" onClick={() => onCover(p.key)} className="flex h-8 items-center gap-1 rounded-full bg-white/95 px-2.5 text-xs font-bold text-ink shadow-card hover:bg-white" aria-label={`Make photo ${n + 1} the cover`}>
                    <Star className="size-3.5" /> Cover
                  </button>
                )}
                <button type="button" onClick={() => onRemove(p.key)} className="grid size-8 place-items-center rounded-full bg-white/95 text-fault shadow-card hover:bg-white" aria-label={`Remove photo ${n + 1}`}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </figure>
        ))}

        {room > 0 && !disabled && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            disabled={!!busy}
            className={cx(
              'flex aspect-square flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed px-3 text-center text-sm transition-colors',
              drag ? 'border-solder bg-solder-tint text-solder-2' : 'border-line text-ink-2 hover:border-solder/60 hover:bg-canvas',
              items.length === 0 && 'col-span-2 aspect-auto py-10 sm:col-span-4',
            )}
          >
            <span className="grid size-11 place-items-center rounded-full bg-solder-tint text-solder"><ImagePlus className="size-5" /></span>
            <span className="font-semibold text-ink">{busy ?? (items.length ? 'Add another photo' : 'Add product photos')}</span>
            {items.length === 0 && <span className="text-ink-3">Drop images here, click to browse, or paste. Up to {max}, JPEG, PNG or WebP.</span>}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        aria-label="Choose product photos"
        onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ''; }}
      />
      {error && <div className="mt-3"><Alert tone="wait">{error}</Alert></div>}
    </div>
  );
}

'use client';

/**
 * Shrinks a photo in the browser before upload: phone cameras produce 3–8 MB files,
 * a product photo needs ~1200 px. Output is WebP (JPEG where WebP encoding is missing).
 */
export const MAX_SIDE = 1200;
export const ACCEPT = 'image/jpeg,image/png,image/webp';

export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error(`${file.name}: use a JPEG, PNG or WebP photo (iPhone HEIC photos: share them as JPEG first)`);
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} could not be read as an image`);
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background, like a product shot
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.85));
  const webp = await toBlob('image/webp');
  const out = webp && webp.type === 'image/webp' ? webp : await toBlob('image/jpeg');
  if (!out) throw new Error(`${file.name} could not be converted`);
  return out;
}

export async function uploadProductImage(productId: string, blob: Blob): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append('file', blob, blob.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
  const res = await fetch(`/api/v1/catalog/products/${productId}/images`, { method: 'POST', body: form, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data as { message?: string | string[] }).message;
    throw new Error(Array.isArray(m) ? m.join('. ') : m ?? `Upload failed (${res.status})`);
  }
  return data as { id: string; url: string };
}

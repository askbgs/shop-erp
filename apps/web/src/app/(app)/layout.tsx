'use client';

import { Shell } from '@/components/shell';
import { SessionProvider } from '@/lib/session';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<div className="grid min-h-dvh place-items-center text-ink-3">Opening your shop…</div>}>
      {() => <Shell>{children}</Shell>}
    </SessionProvider>
  );
}

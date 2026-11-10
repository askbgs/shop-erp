'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

export interface Me {
  id: string;
  name: string;
  email: string;
  isTechnician: boolean;
  mustChangePassword: boolean;
  role: { id: string; name: string };
  tenant: { id: string; name: string; businessType: string; status: string; trialEndsAt: string | null };
  branches: { id: string; name: string; code: string }[];
  permissions: string[];
  features: string[];
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: (n, e: unknown) => n < 1 && (e as { status?: number })?.status !== 403 && (e as { status?: number })?.status !== 404, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface SessionValue {
  me: Me;
  branchId: string;
  branch: Me['branches'][number];
  setBranchId: (id: string) => void;
  can: (permission: string) => boolean;
  has: (feature: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);
const BRANCH_KEY = 'shop-erp.branch';

export function SessionProvider({ children, fallback }: { children: (s: SessionValue) => ReactNode; fallback: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 60_000 });
  const [branchId, setBranch] = useState<string>('');

  useEffect(() => {
    if (!me.data) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(BRANCH_KEY);
    } catch {
      /* storage unavailable */
    }
    const valid = me.data.branches.find((b) => b.id === saved);
    setBranch(valid ? valid.id : me.data.branches[0]?.id ?? '');
  }, [me.data]);

  const value = useMemo<SessionValue | null>(() => {
    if (!me.data || !branchId) return null;
    const branch = me.data.branches.find((b) => b.id === branchId) ?? me.data.branches[0];
    return {
      me: me.data,
      branchId: branch.id,
      branch,
      setBranchId: (id) => {
        setBranch(id);
        try {
          localStorage.setItem(BRANCH_KEY, id);
        } catch {
          /* ignore */
        }
      },
      can: (p) => me.data!.permissions.includes(p),
      has: (f) => me.data!.features.includes(f),
    };
  }, [me.data, branchId]);

  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children(value)}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

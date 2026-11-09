import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Backend-for-frontend session. The browser never sees the API tokens: the access and
 * refresh tokens live in httpOnly cookies, and the Next.js server attaches them when it
 * forwards a request to the API.
 */
export const ACCESS_COOKIE = 'se_at';
export const REFRESH_COOKIE = 'se_rt';

export const apiUrl = () => (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const secure = process.env.NODE_ENV === 'production';

export function setSessionCookies(res: NextResponse, t: TokenPair) {
  // Access token cookie expires a minute before the token itself, so a stale token is never sent.
  res.cookies.set(ACCESS_COOKIE, t.accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 14 * 60 });
  res.cookies.set(REFRESH_COOKIE, t.refreshToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 24 * 3600 });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { path: '/', maxAge: 0 });
}

/**
 * Refresh tokens rotate on every use and a reused token signs out every session.
 * When several browser requests arrive together with an expired access token, they must
 * share ONE refresh call, so in-flight refreshes are de-duplicated per refresh token.
 */
const inflight = new Map<string, Promise<TokenPair | null>>();

export function refreshTokens(refreshToken: string, meta: { ip?: string; ua?: string }): Promise<TokenPair | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const p = (async () => {
    const res = await fetch(`${apiUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(meta.ip ? { 'x-forwarded-for': meta.ip } : {}), ...(meta.ua ? { 'user-agent': meta.ua } : {}) },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenPair;
  })();
  inflight.set(refreshToken, p);
  // Keep the result briefly so late parallel requests reuse it, then forget it.
  p.finally(() => setTimeout(() => inflight.delete(refreshToken), 30_000));
  return p;
}

export function clientMeta(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    ua: req.headers.get('user-agent') ?? undefined,
  };
}

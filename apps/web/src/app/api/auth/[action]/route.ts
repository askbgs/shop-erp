import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE, apiUrl, clearSessionCookies, clientMeta, REFRESH_COOKIE, refreshTokens, setSessionCookies, TokenPair,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Sign-in, sign-up, PIN switch, refresh and sign-out. Tokens go into httpOnly cookies. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const meta = clientMeta(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (meta.ip) headers['x-forwarded-for'] = meta.ip;
  if (meta.ua) headers['user-agent'] = meta.ua;

  if (action === 'logout') {
    const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
    if (refresh) {
      await fetch(`${apiUrl()}/api/v1/auth/logout`, { method: 'POST', headers, body: JSON.stringify({ refreshToken: refresh }) }).catch(() => undefined);
    }
    const res = NextResponse.json({ ok: true });
    clearSessionCookies(res);
    return res;
  }

  if (action === 'refresh') {
    const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
    const t = refresh ? await refreshTokens(refresh, meta) : null;
    if (!t) {
      const res = NextResponse.json({ statusCode: 401, message: 'Session expired' }, { status: 401 });
      clearSessionCookies(res);
      return res;
    }
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, t);
    return res;
  }

  const target = { login: 'auth/login', register: 'auth/register', 'pin-switch': 'auth/pin-switch', 'change-password': 'auth/change-password' }[action];
  if (!target) return NextResponse.json({ statusCode: 404, message: 'Not found' }, { status: 404 });
  if (action === 'pin-switch' || action === 'change-password') {
    const access = req.cookies.get(ACCESS_COOKIE)?.value;
    if (access) headers.authorization = `Bearer ${access}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}/api/v1/${target}`, { method: 'POST', headers, body: await req.text(), cache: 'no-store' });
  } catch {
    return NextResponse.json({ statusCode: 502, message: 'The server is not reachable. Check your connection and try again.' }, { status: 502 });
  }
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
  const res = NextResponse.json({ ok: true });
  setSessionCookies(res, data as TokenPair);
  return res;
}

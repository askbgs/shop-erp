import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE, apiUrl, clearSessionCookies, clientMeta, REFRESH_COOKIE, refreshTokens, setSessionCookies, TokenPair,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Token-issuing endpoints go through /api/auth/* so tokens never reach browser JavaScript.
const BLOCKED = /^auth\/(login|register|refresh|logout|pin-switch|change-password)$/;
// Upstream headers that must not be copied onto our response.
const HOP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);

async function forward(req: NextRequest, path: string, body: ArrayBuffer | undefined, access: string | undefined) {
  const meta = clientMeta(req);
  const headers: Record<string, string> = { accept: req.headers.get('accept') ?? 'application/json' };
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  if (access) headers.authorization = `Bearer ${access}`;
  if (meta.ip) headers['x-forwarded-for'] = meta.ip;
  if (meta.ua) headers['user-agent'] = meta.ua;
  return fetch(`${apiUrl()}/api/v1/${path}${req.nextUrl.search}`, { method: req.method, headers, body, cache: 'no-store', redirect: 'manual' });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.map(encodeURIComponent).join('/');
  if (BLOCKED.test(path)) return NextResponse.json({ statusCode: 404, message: 'Not found' }, { status: 404 });

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let renewed: TokenPair | null = null;

  if (!access && refresh) {
    renewed = await refreshTokens(refresh, clientMeta(req));
    access = renewed?.accessToken;
  }

  let upstream: Response;
  try {
    upstream = await forward(req, path, body, access);
    if (upstream.status === 401 && refresh && !renewed) {
      renewed = await refreshTokens(refresh, clientMeta(req));
      if (renewed) upstream = await forward(req, path, body, renewed.accessToken);
    }
  } catch {
    return NextResponse.json({ statusCode: 502, message: 'The server is not reachable. Check your connection and try again.' }, { status: 502 });
  }

  const headers = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP.has(k.toLowerCase())) headers.set(k, v);
  });
  const res = new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers });
  if (renewed) setSessionCookies(res, renewed);
  else if (upstream.status === 401 && refresh) clearSessionCookies(res);
  return res;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };

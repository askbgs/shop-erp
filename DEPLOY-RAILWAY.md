# Deploy Shop ERP on Railway

You will create **4 services in one Railway project**:

| Service | What it is | Public URL? |
| --- | --- | --- |
| `Postgres` | Railway PostgreSQL database | No |
| `Redis` | Railway Redis (message queue) | No |
| `api` | NestJS API, built from `apps/api/Dockerfile` | Optional (for `/docs` and the vendor console) |
| `web` | Next.js app, built from `apps/web/Dockerfile` | **Yes**: this is what shops use |

The browser only talks to `web`. The web server forwards API calls to `api` over Railway's
private network and keeps the login tokens in secure cookies, so the API does not need to be public.

> Railway is retiring `railway.json` / `railway.toml` config files on 2026-12-01, so this repo
> does not use them. Everything below is set in the Railway dashboard.

## 1. Put the code on GitHub

```bash
cd shop-erp
git init && git add . && git commit -m "Shop ERP phase 1"
git branch -M main
git remote add origin https://github.com/<you>/shop-erp.git
git push -u origin main
```

`.gitignore` already keeps out `node_modules`, `.env` files and build output.

## 2. Create the project and the databases

1. In Railway: **New Project → Deploy from GitHub repo →** pick `shop-erp`.
   This creates the first service. Open it, then **Settings → Service name**: rename it to `api`.
2. In the project canvas: **+ Create → Database → PostgreSQL**. Leave its name as `Postgres`.
3. **+ Create → Database → Redis**. Leave its name as `Redis`.

The `${{Postgres.…}}` and `${{api.…}}` references below use these exact service names;
if you name them differently, change the references to match.

## 3. Configure the `api` service

**Settings**
- **Root Directory**: leave empty (the Dockerfile builds from the repository root).
- **Watch Paths** (optional, avoids rebuilding the API when only the web app changes): `apps/api/**`

**Variables** (open the service → Variables → Raw Editor, paste, then fill in the secrets):

```env
RAILWAY_DOCKERFILE_PATH=/apps/api/Dockerfile
NODE_ENV=production
PORT=3000
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
APP_TIMEZONE=Asia/Colombo

JWT_ACCESS_SECRET=<paste: openssl rand -base64 48>
ENCRYPTION_KEY=<paste: openssl rand -base64 32>
ADMIN_API_KEY=<paste: openssl rand -hex 24>

JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
TRIAL_DAYS=14
CORS_ORIGINS=https://<your-web-domain>
PUBLIC_TRACKING_URL=https://<your-web-domain>/track

NOTIFICATIONS_DRIVER=log
```

Generate the three secrets on your computer (Git Bash, WSL, macOS or Linux):

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY  (must decode to exactly 32 bytes)
openssl rand -hex 24      # ADMIN_API_KEY
```

**Keep `ENCRYPTION_KEY` safe and never change it.** It encrypts the device passcodes on repair jobs;
with a new key the old passcodes can no longer be read.

Deploy the service. On every start the container runs `prisma migrate deploy` (creating or
updating the tables) and then starts the API. In **Deployments → View logs** you should see
`All migrations have been successfully applied` and `API on http://localhost:3000/api/v1`.

## 4. Add the `web` service

1. In the project canvas: **+ Create → GitHub Repo →** the same `shop-erp` repo. Rename the new service to `web`.
2. **Settings → Root Directory**: leave empty. **Watch Paths** (optional): `apps/web/**`
3. **Variables:**

```env
RAILWAY_DOCKERFILE_PATH=/apps/web/Dockerfile
NODE_ENV=production
API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
```

4. **Settings → Networking → Generate Domain.** Railway gives you something like
   `web-production-1234.up.railway.app`. If it asks for a port, use the port shown in the
   deploy logs (Railway passes its own `PORT`, which the Next.js server uses).
5. Go back to `api` → Variables and put this domain into `CORS_ORIGINS` and `PUBLIC_TRACKING_URL`
   (with `https://`). Saving variables redeploys the API.

## 5. Check it works

1. Open `https://<your-web-domain>/register` and create your shop. You should land on **Today**.
2. Add a product, receive stock with an IMEI, and make a sale at **Point of sale**.
3. Take in a repair, then open `https://<your-web-domain>/track` in a private window and enter
   the job's tracking code and the customer's mobile number.

If the web app shows *"The server is not reachable"*, `web` cannot reach `api`. Check that
`API_URL` resolves (both services must be in the same project and environment) and that `api` has `PORT=3000`.

## 6. Optional: give the API a public domain

Do this when you want the Swagger docs (`/docs`) or the vendor console:

- `api` → **Settings → Networking → Generate Domain**.
- Docs: `https://<api-domain>/docs`
- Vendor console (your SaaS admin):

```bash
curl https://<api-domain>/api/v1/admin/tenants -H "x-admin-key: <ADMIN_API_KEY>"
# activate a shop after it pays (raise an invoice, then mark it paid)
curl -X POST https://<api-domain>/api/v1/admin/tenants/<tenantId>/invoices -H "x-admin-key: <ADMIN_API_KEY>"
curl -X POST https://<api-domain>/api/v1/admin/invoices/<invoiceId>/paid -H "x-admin-key: <ADMIN_API_KEY>" \
     -H "content-type: application/json" -d '{"paymentRef":"PAYHERE-12345"}'
```

## 7. Turn on SMS and WhatsApp

Set these on `api` (then redeploy):

```env
NOTIFICATIONS_DRIVER=live
SMS_GATEWAY_URL=https://<your-sms-gateway>/send        # receives POST {to, message}
SMS_GATEWAY_TOKEN=<token>                               # sent as "Authorization: Bearer <token>"
WHATSAPP_WEBHOOK_URL=https://<your-n8n>/webhook/whatsapp # receives POST {to, message, event, tenantId}
WHATSAPP_WEBHOOK_TOKEN=<token>
```

Messages that fail are retried 3 times; every message is listed under **Settings → Customer messages**
in the app and in the `notification_logs` table.

## 8. Optional: repair photos on Cloudflare R2

Create an R2 bucket and an API token with read/write on it, then set on `api`:

```env
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<key id>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET=shop-erp-photos
```

In the bucket's CORS settings, allow `PUT` from `https://<your-web-domain>`.

## 9. Your own domain

`web` → **Settings → Networking → Custom Domain**, enter e.g. `app.yourdomain.lk`, and add the
CNAME record Railway shows at your DNS provider. Then update `CORS_ORIGINS` and
`PUBLIC_TRACKING_URL` on `api` to the new domain.

## Notes

- **Migrations** run automatically on each API start. Run the API as one replica, so two copies
  never migrate at the same time.
- **Plans** (`REPAIR_ONLY`, `POS_REPAIRS`, `FULL`) are created on the first sign-up. To change prices,
  edit `DEFAULT_PLANS` in `apps/api/src/common/permissions.ts` before the first sign-up, or update the
  `plans` table afterwards.
- **Private networking**: Redis is connected with `family: 0`, and the API listens on all interfaces,
  so this works in both new (IPv4 + IPv6) and older (IPv6-only) Railway environments.
- **Backups**: the Postgres service holds all shop data. Set up regular backups (for example a
  scheduled `pg_dump` to R2) before you onboard paying shops.
- **Local run** of the same images: `docker compose --profile full up --build`
  (create `apps/api/.env` from `apps/api/.env.example` first).

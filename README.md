# Shop ERP — Phase 1

Cloud ERP for phone shops, computer shops and repair centers in Sri Lanka.
Phase 1 (MVP): a multi-tenant NestJS API (`apps/api`) and a Next.js web app (`apps/web`).

**Deploying?** Follow [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md).

| Layer | Choice |
| --- | --- |
| API | NestJS 11, TypeScript, REST, Swagger at `/docs` |
| Database | PostgreSQL 16 via Prisma 7 (`@prisma/adapter-pg`) |
| Jobs | Redis + BullMQ (SMS / WhatsApp notifications) |
| Files | Cloudflare R2 presigned uploads (repair photos) |
| Web | Next.js 16 (App Router), React 19, Tailwind 4, TanStack Query; cookie sessions via a server-side proxy |
| Monorepo | npm workspaces + Turborepo |

## Phase 1 modules

| # | Module | Where |
| --- | --- | --- |
| 1 | Tenants & plans (self sign-up, trial, plan features, vendor console) | `modules/auth`, `modules/platform/tenant|admin` |
| 2 | Branches & settings (VAT, warranty days, number series) | `modules/platform/branches`, `tenant` |
| 3 | Users, roles & permissions (discount limits, PIN switch, sessions) | `modules/platform/users`, `modules/auth` |
| 4 | Audit log (append-only) | `modules/core` |
| 5 | Product catalog (variants, price history, POS scan lookup) | `modules/catalog` |
| 6 | Serialized stock & ledger (IMEI/serial units, receipts, adjustments, ageing) | `modules/stock` |
| 8 | POS & invoicing (split pay, change, credit, held bills, void, receipt) | `modules/sales` |
| 9 | Payments (basic: cash, card, transfer, LankaQR, cheque, loyalty points) | `modules/sales` (`/payments`) |
| 11 | Repairs (job cards, workflow, technicians, parts, passcode, tracking) | `modules/repairs` |
| 17 | Customers, CRM & loyalty | `modules/customers` |
| 18 | Notifications (templates in en/ta, BullMQ worker, SMS gateway + n8n WhatsApp) | `modules/notifications` |
| — | Basic owner dashboard | `modules/reports` |

## Run it locally

Requirements: Node 20+, Docker (for Postgres and Redis).

```bash
docker compose up -d postgres redis          # Postgres on 5432, Redis on 6379
npm install                                  # also runs `prisma generate`
cd apps/api
cp .env.example .env                         # then fill JWT_ACCESS_SECRET, ENCRYPTION_KEY, ADMIN_API_KEY
#   openssl rand -base64 48   → JWT_ACCESS_SECRET
#   openssl rand -base64 32   → ENCRYPTION_KEY
npm run db:deploy                            # apply migrations
npm run db:seed                              # create the 3 SaaS plans
npm run dev                                  # http://localhost:3000/api/v1, docs at /docs

# in a second terminal
cd apps/web
cp .env.example .env.local                   # API_URL=http://localhost:3000
npm run dev                                  # http://localhost:3001
```

## Web app screens

| Screen | For |
| --- | --- |
| Today | Owner dashboard: sales, profit, money received, repairs by status, low stock |
| Point of sale | Scan IMEI/barcode, search, customer quick-add, discounts, split payments, change, held bills, print receipt. Sales made while offline are kept on the device and synced later without duplicates |
| Repairs | Job list by status, intake form (accessories, condition, passcode, advance), job page with the station track, next-step buttons, parts, diagnosis, hand-over and payments |
| Sales | Invoices by date, invoice detail, collect a balance, same-day void |
| Stock | Levels with reorder flag and count correction, IMEI/serial search, old-stock ageing, deliveries; receive stock with IMEIs pasted one per line |
| Products | Catalogue with options and prices, price editing |
| Customers | Search, add, 360° page with devices, warranties, invoices, repairs, points |
| Settings | Shop (VAT, warranty, loyalty), staff with roles and PINs, branches, customer messages, plan |
| /track | Public page where customers check a repair with its tracking code and their mobile number |

The browser never holds API tokens: `/api/auth/*` and `/api/v1/*` in the web app are server routes
that keep the tokens in httpOnly cookies and forward requests to the API.


Run the tests:

```bash
npm test                                     # unit tests (money/VAT, IMEI, repair workflow, dates)
npm run smoke                                # 90 end-to-end checks against the running API
```

The smoke test registers a fresh demo shop each run and prints its login at the end.
`ADMIN_API_KEY` in your shell must match the one in `.env` for the vendor console checks.

Full stack in Docker: `docker compose --profile full up --build`.

## How it works

**Multi-tenancy.** Every business table has `tenantId`; every query filters by the tenant in the access token.
Branch access is checked on every write (`assertBranchAccess`). The token's `branchIds` holds only the
user's own shop's branches, so a request cannot name another shop's branch. The smoke test checks
isolation for invoices, IMEIs, customers and branches.

**Stock.** `StockService` is the only code that changes stock. Each change writes a `stock_movements`
row and updates `stock_balances` in the same transaction, so balances always equal the ledger.
Serialized units (`stock_units`) carry IMEI 1, IMEI 2 and serial, all unique per tenant and
Luhn-checked. Selling a unit uses a conditional update, so two cashiers can never sell the same
phone (tested with 5 parallel requests: 1 succeeds, 4 get 409).

**Money.** Integer cents everywhere, LKR. Prices are VAT-inclusive by default (18%, changeable).
Bill discounts are spread across lines so line VAT always adds up to the invoice VAT.

**Sales rules.** Discounts above the role's limit need `discount.override`; prices below the minimum
need `price.override` (both audited). Credit sales need a customer, `sales.credit` and respect the
credit limit. Only cash can be over-tendered (the rest is change). Voids are same-day only and
put units back in stock, reverse payments and loyalty points.

**Offline POS.** Send a `clientRef` (idempotency key) with each sale. Re-sending the same key
returns the original invoice, so a POS that syncs queued sales after a connection drop never
creates duplicates.

**Repairs.** Statuses: Received → Diagnosing → Waiting approval → (Waiting parts) → In repair →
Quality check → Ready → Delivered, with exits Rejected, Not repairable and Cancelled. Delivery
settles the bill, refunds any excess advance, and starts the repair warranty (30 days default).
Device passcodes are AES-256-GCM encrypted; only the assigned technician (or `repair.passcode_view`)
can read one, and every read is audited. Customers track a job at
`GET /api/v1/public/repairs/track?code=…&phone=…` using the job's 10-character tracking code
(job numbers repeat across shops, so they are not used for public lookups).

**Notifications.** Business code calls `NotificationsService.notify()` after the transaction commits.
Messages are rendered from the tenant's templates and sent by a BullMQ worker with 3 retries.
`NOTIFICATIONS_DRIVER=log` prints them (development); `live` POSTs `{to, message}` to your Android
SMS gateway and to an n8n webhook for WhatsApp.

**Subscriptions.** Sign-up starts a trial. An expired trial or a `SUSPENDED` tenant becomes read-only
(writes return 402). The vendor console (`/api/v1/admin/*`, header `x-admin-key`) lists tenants,
changes plans and status, raises monthly invoices and marks them paid, which reactivates the shop.

## Main endpoints (all under `/api/v1`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST auth/register`, `auth/login`, `auth/refresh`, `auth/logout`, `auth/pin-switch`; `GET auth/me`, `auth/sessions` |
| Tenant | `GET/PATCH tenant`, `tenant/settings`; `GET tenant/subscription`, `tenant/districts` |
| Branches | `GET/POST branches`, `PATCH branches/:id`, `PATCH branches/:id/number-series` |
| Users & roles | `GET/POST users`, `PATCH users/:id`, `GET users/technicians`; `GET/POST roles`, `PATCH roles/:id`, `GET roles/permissions` |
| Catalog | `categories`, `brands`, `products`, `products/:id/variants`, `PATCH variants/:id`, `GET lookup?code=` |
| Stock | `POST stock/receipts`, `GET stock/units`, `GET stock/units/:id`, `GET stock/balances`, `GET stock/movements`, `POST stock/adjustments`, `GET stock/ageing` |
| Sales | `POST/GET sales/invoices`, `POST sales/invoices/:id/void`, `GET sales/invoices/:id/receipt`, `sales/held` |
| Payments | `POST/GET payments` |
| Customers | `GET/POST customers`, `GET customers/:id` (360° view), `GET customers/by-phone/:phone`, `POST customers/:id/loyalty-adjustments` |
| Repairs | `POST/GET repairs`, `GET repairs/my-queue`, `PATCH repairs/:id`, `POST repairs/:id/status|assign|parts|deliver`, `GET repairs/:id/passcode|job-card`, photo upload |
| Public | `GET public/repairs/track?code=&phone=` |
| Notifications | `GET notifications/events|templates|logs`, `POST notifications/templates|test` |
| Reports | `GET reports/dashboard` |
| Audit | `GET audit-logs` |
| Vendor | `GET admin/tenants`, `PATCH admin/tenants/:id`, `POST admin/tenants/:id/invoices`, `POST admin/invoices/:id/paid` |

The complete, typed list (96 operations) is in Swagger at `http://localhost:3000/docs`.

## Notes and next steps

- **Prisma 7** is used rather than 6: it is the current stable line and runs the query engine without
  native binaries (via the `pg` driver adapter). The database URL lives in `apps/api/prisma.config.ts`.
- **After creating a branch** call `POST /auth/refresh`; branch access is carried in the access token.
- **Postgres row-level security** is not switched on yet; tenant isolation is enforced in the API layer
  and covered by tests. Adding RLS policies as a second safety net is a good hardening step.
- Not in Phase 1 by design: transfers & stock counts, installments/BNPL, quotations & returns, warranty
  claims, purchasing, supplier RMA, trade-in (Phase 2); accounting, HR, full reports (Phase 3).
- **Next round:** Phase 2 modules (transfers, installments, quotations & returns, warranty claims,
  purchasing, supplier RMA, trade-in) and the Flutter technician app.

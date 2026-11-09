# Shop ERP API. Build context = repository root:
#   docker build -f apps/api/Dockerfile .
# On Railway: set RAILWAY_DOCKERFILE_PATH=/apps/api/Dockerfile and leave Root Directory empty.

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# --ignore-scripts: the postinstall `prisma generate` needs the schema, which is copied next
RUN npm ci --workspace @shop-erp/api --include-workspace-root --ignore-scripts
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN npx prisma generate && npx nest build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
# Apply any pending database migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

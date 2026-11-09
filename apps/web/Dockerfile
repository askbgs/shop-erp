# Shop ERP web app. Build context = repository root:
#   docker build -f apps/web/Dockerfile .
# On Railway: set RAILWAY_DOCKERFILE_PATH=/apps/web/Dockerfile and leave Root Directory empty.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @shop-erp/web --include-workspace-root --ignore-scripts
COPY apps/web apps/web
RUN npm run build --workspace @shop-erp/web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3001
# Next.js standalone output: a minimal server with only the files it needs
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3001
# API_URL (runtime) tells the server where the API is, e.g. http://api.railway.internal:3000
CMD ["node", "apps/web/server.js"]

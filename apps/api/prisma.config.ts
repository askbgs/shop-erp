import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  // process.env (not env()) so `prisma generate` works before a .env file exists,
  // e.g. during `npm install` or a Docker build. Migrate commands still need DATABASE_URL.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});

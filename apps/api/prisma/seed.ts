import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { DEFAULT_PLANS } from '../src/common/permissions';

/** Creates / updates the SaaS plans. Tenants are created through POST /api/v1/auth/register. */
async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({ where: { code: p.code }, update: { name: p.name, priceCents: p.priceCents, features: p.features, maxUsers: p.maxUsers }, create: p });
    console.log(`plan ${p.code} ready`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

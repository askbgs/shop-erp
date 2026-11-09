import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),

  // 32-byte key, base64 — used to encrypt device passcodes on repair jobs
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)',
  }),

  // Vendor (super-admin) console
  ADMIN_API_KEY: z.string().min(24),

  TRIAL_DAYS: z.coerce.number().default(14),
  APP_TIMEZONE: z.string().default('Asia/Colombo'),
  PUBLIC_TRACKING_URL: z.string().default('http://localhost:3001/track'),

  // Notifications: "log" marks messages as sent without calling providers (dev)
  NOTIFICATIONS_DRIVER: z.enum(['log', 'live']).default('log'),
  SMS_GATEWAY_URL: z.string().optional(),
  SMS_GATEWAY_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_URL: z.string().optional(), // n8n webhook that sends WhatsApp messages
  WHATSAPP_WEBHOOK_TOKEN: z.string().optional(),

  // Cloudflare R2 (S3 compatible) for repair photos
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  return parsed.data;
}

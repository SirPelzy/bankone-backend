import { z } from "zod";

const serverEnvSchema = z.object({
  APP_ENV: z.enum(["test", "production"]),
  APP_BASE_URL: z.string().url(),
  API_INTERNAL_SECRET: z.string().min(24),
  CRON_SECRET: z.string().min(24),
  WEBHOOK_REPLAY_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  NEXT_PUBLIC_MONO_PUBLIC_KEY: z.string().min(1),
  MONO_SECRET_KEY: z.string().min(1),
  MONO_WEBHOOK_SECRET: z.string().min(1),
  MONO_BASE_URL: z.string().url().default("https://api.withmono.com"),
  NOMBA_ACCOUNT_ID: z.string().min(1),
  NOMBA_CLIENT_ID: z.string().min(1),
  NOMBA_CLIENT_SECRET: z.string().min(1),
  NOMBA_WEBHOOK_SIGNATURE_KEY: z.string().min(1),
  NOMBA_BASE_URL: z.string().url().default("https://api.nomba.com"),
  NOMBA_CHECKOUT_CALLBACK_URL: z.string().url(),
  NOMBA_WEBHOOK_URL: z.string().url(),
  NOMBA_TRANSFER_SENDER_NAME: z.string().min(1).default("BankOne"),
  NOMBA_DEFAULT_CURRENCY: z.string().min(3).max(3).default("NGN"),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.string().default("info")
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${missing}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCacheForTests() {
  cachedEnv = null;
}

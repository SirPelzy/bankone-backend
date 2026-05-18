import { resetEnvCacheForTests } from "./env";

export function installTestEnv(overrides: Record<string, string> = {}) {
  Object.assign(process.env, {
    APP_ENV: "test",
    APP_BASE_URL: "https://bankone-test.vercel.app",
    API_INTERNAL_SECRET: "test_internal_secret_1234567890",
    CRON_SECRET: "test_cron_secret_1234567890",
    WEBHOOK_REPLAY_TOLERANCE_SECONDS: "300",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUPABASE_DB_URL: "postgres://example",
    SUPABASE_JWT_SECRET: "jwt",
    NEXT_PUBLIC_MONO_PUBLIC_KEY: "mono_pk",
    MONO_SECRET_KEY: "mono_sk",
    MONO_WEBHOOK_SECRET: "mono_wh",
    MONO_BASE_URL: "https://api.withmono.com",
    NOMBA_ACCOUNT_ID: "account",
    NOMBA_CLIENT_ID: "client",
    NOMBA_CLIENT_SECRET: "secret",
    NOMBA_WEBHOOK_SIGNATURE_KEY: "nomba_webhook_secret",
    NOMBA_BASE_URL: "https://api.nomba.com",
    NOMBA_CHECKOUT_CALLBACK_URL: "https://bankone-test.vercel.app/api/nomba/callback",
    NOMBA_WEBHOOK_URL: "https://bankone-test.vercel.app/api/webhooks/nomba",
    NOMBA_TRANSFER_SENDER_NAME: "BankOne",
    NOMBA_DEFAULT_CURRENCY: "NGN",
    LOG_LEVEL: "silent",
    ...overrides
  });
  resetEnvCacheForTests();
}

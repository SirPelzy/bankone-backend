import { getEnv } from "@/lib/env";
import { handleApiError, ok } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const env = getEnv();
    const supabase = createServiceClient();
    const { error } = await supabase.from("transactions").select("id", { count: "exact", head: true }).limit(1);

    if (error) throw error;

    return ok({
      status: "healthy",
      environment: env.APP_ENV,
      providers: {
        mono: Boolean(env.MONO_SECRET_KEY),
        nomba: Boolean(env.NOMBA_CLIENT_ID && env.NOMBA_CLIENT_SECRET)
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

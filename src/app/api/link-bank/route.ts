import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { handleApiError, ok, readJson } from "@/lib/http";
import { exchangeMonoAuthCode } from "@/lib/providers/mono";
import { linkBankSchema, parseWithSchema } from "@/lib/schemas";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const body = parseWithSchema(linkBankSchema, await readJson(request));
    const mono = await exchangeMonoAuthCode(body.auth_code);
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("funding_sources")
      .upsert(
        {
          environment: env.APP_ENV,
          user_id: user.id,
          provider: "mono",
          source_type: "bank_account",
          provider_ref: mono.accountId,
          display_name: "Linked bank account",
          status: "active",
          metadata: { mono_auth_response: mono.raw }
        },
        { onConflict: "environment,user_id,provider,provider_ref" }
      )
      .select("id,provider,source_type,provider_ref,status,display_name,created_at")
      .single();

    if (error) throw error;
    return ok(data);
  } catch (error) {
    return handleApiError(error);
  }
}

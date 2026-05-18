import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { handleApiError, ok } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const { id } = await context.params;
    const supabase = createServiceClient();

    const { data: transaction, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", id)
      .eq("environment", env.APP_ENV)
      .eq("user_id", user.id)
      .single();

    if (error || !transaction) throw new ApiError(404, "transaction_not_found", "Transaction was not found.");
    if (transaction.status !== "partial_funded") {
      throw new ApiError(409, "transaction_not_partial", "Only partially funded transactions can be retained in wallet.");
    }

    const { data, error: updateError } = await supabase
      .from("transactions")
      .update({
        status: "cancelled",
        metadata: {
          ...(transaction.metadata ?? {}),
          wallet_retention_confirmed_at: new Date().toISOString()
        }
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) throw updateError;
    return ok(data);
  } catch (error) {
    return handleApiError(error);
  }
}

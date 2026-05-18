import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { handleApiError, ok } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase";
import { enqueueTransferFunding } from "@/lib/transactions";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const { id } = await context.params;
    const supabase = createServiceClient();

    const { data: transaction, error } = await supabase
      .from("transactions")
      .select("id,status,user_id")
      .eq("id", id)
      .eq("environment", env.APP_ENV)
      .eq("user_id", user.id)
      .single();

    if (error || !transaction) throw new ApiError(404, "transaction_not_found", "Transaction was not found.");
    if (!["pending", "funding", "partial_funded", "failed"].includes(transaction.status)) {
      throw new ApiError(409, "transaction_not_retryable", "This transaction cannot be retried from its current status.");
    }

    await supabase.from("transactions").update({ status: "pending", failure_reason: null }).eq("id", id);
    const msgId = await enqueueTransferFunding(supabase, id);
    return ok({ transaction_id: id, queue_message_id: msgId });
  } catch (error) {
    return handleApiError(error);
  }
}

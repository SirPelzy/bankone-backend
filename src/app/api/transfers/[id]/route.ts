import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { handleApiError, ok } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase";
import { getTransactionForUser } from "@/lib/transactions";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const { id } = await context.params;
    const supabase = createServiceClient();
    const transaction = await getTransactionForUser({
      supabase,
      environment: env.APP_ENV,
      userId: user.id,
      transactionId: id
    });

    return ok(transaction);
  } catch (error) {
    return handleApiError(error);
  }
}

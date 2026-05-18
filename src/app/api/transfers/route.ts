import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { created, handleApiError, readJson } from "@/lib/http";
import { assertPositiveKobo } from "@/lib/money";
import { createTransferSchema, parseWithSchema } from "@/lib/schemas";
import { createServiceClient } from "@/lib/supabase";
import { createTransfer } from "@/lib/transactions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const body = parseWithSchema(createTransferSchema, await readJson(request));
    const supabase = createServiceClient();

    const transaction = await createTransfer({
      supabase,
      environment: env.APP_ENV,
      userId: user.id,
      amountKobo: assertPositiveKobo(body.amount_kobo),
      recipient: body.recipient,
      narration: body.narration
    });

    return created({
      ...transaction,
      remaining_kobo: transaction.amount_kobo - transaction.funded_kobo
    });
  } catch (error) {
    return handleApiError(error);
  }
}

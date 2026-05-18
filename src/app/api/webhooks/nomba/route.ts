import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { handleApiError, ok } from "@/lib/http";
import { verifyNombaWebhookSignature } from "@/lib/providers/nomba";
import { createServiceClient } from "@/lib/supabase";
import { handleNombaWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const rawBody = await request.text();
    if (!verifyNombaWebhookSignature(rawBody, request.headers)) {
      throw new ApiError(401, "invalid_webhook_signature", "Invalid Nomba webhook signature.");
    }

    const payload = JSON.parse(rawBody);
    const supabase = createServiceClient();
    const result = await handleNombaWebhook({
      supabase,
      environment: env.APP_ENV,
      payload
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}

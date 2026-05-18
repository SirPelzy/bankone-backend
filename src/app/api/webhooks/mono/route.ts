import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { handleApiError, ok } from "@/lib/http";
import { verifyMonoWebhook } from "@/lib/providers/mono";
import { createServiceClient } from "@/lib/supabase";
import { recordWebhookEvent } from "@/lib/webhooks";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    if (!verifyMonoWebhook(request)) {
      throw new ApiError(401, "invalid_webhook_secret", "Invalid Mono webhook secret.");
    }

    const payload = await request.json();
    const eventId = payload.id ?? payload.event_id ?? payload.reference ?? randomUUID();
    const eventType = payload.event ?? payload.event_type ?? "mono_event";
    const supabase = createServiceClient();

    const result = await recordWebhookEvent({
      supabase,
      environment: env.APP_ENV,
      provider: "mono",
      eventId,
      eventType,
      providerRef: payload.account?._id ?? payload.account_id,
      payload
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}

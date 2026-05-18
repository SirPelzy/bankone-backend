import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { handleApiError, ok } from "@/lib/http";
import { verifyNombaWebhookSignature } from "@/lib/providers/nomba";
import { createServiceClient } from "@/lib/supabase";
import { handleNombaWebhook, type NombaWebhookPayload } from "@/lib/webhooks";

export const runtime = "nodejs";

export async function GET() {
  return ok({
    provider: "nomba",
    status: "reachable"
  });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const hasSignatureHeaders =
      Boolean(request.headers.get("nomba-signature") ?? request.headers.get("nomba-sig-value")) &&
      Boolean(request.headers.get("nomba-timestamp"));

    if (!rawBody.trim()) {
      return ok({
        provider: "nomba",
        status: "reachable"
      });
    }

    if (!hasSignatureHeaders) {
      return ok({
        provider: "nomba",
        status: "verification_acknowledged",
        processed: false
      });
    }

    let env: ReturnType<typeof getEnv>;
    try {
      env = getEnv();
    } catch (error) {
      return ok({
        code: "webhook_not_configured",
        provider: "nomba",
        status: "reachable_but_not_configured",
        processed: false,
        detail:
          error instanceof Error
            ? error.message
            : "NOMBA_WEBHOOK_SIGNATURE_KEY must be set before signed webhooks can be processed."
      });
    }

    if (!verifyNombaWebhookSignature(rawBody, request.headers)) {
      throw new ApiError(401, "invalid_webhook_signature", "Invalid Nomba webhook signature.");
    }

    let payload: NombaWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as NombaWebhookPayload;
    } catch {
      throw new ApiError(400, "invalid_json", "Webhook body must be valid JSON.");
    }

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

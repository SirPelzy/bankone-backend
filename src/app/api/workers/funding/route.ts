import { getEnv } from "@/lib/env";
import { handleApiError, ok, requireCronAuth } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase";
import { processFundingQueue } from "@/lib/worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    requireCronAuth(request, env.CRON_SECRET);
    const supabase = createServiceClient();
    const result = await processFundingQueue(supabase);
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}

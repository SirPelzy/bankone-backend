import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { created, handleApiError, readJson } from "@/lib/http";
import { makeCardOrderReference } from "@/lib/idempotency";
import { createNombaTokenizingCheckout } from "@/lib/providers/nomba";
import { createCardCheckoutSchema, parseWithSchema } from "@/lib/schemas";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const body = parseWithSchema(createCardCheckoutSchema, await readJson(request));
    const orderReference = makeCardOrderReference(user.id);

    const checkout = await createNombaTokenizingCheckout({
      orderReference,
      userId: user.id,
      customerEmail: body.customer_email,
      amountKobo: body.amount_kobo
    });

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("card_link_sessions")
      .insert({
        environment: env.APP_ENV,
        user_id: user.id,
        order_reference: orderReference,
        checkout_link: checkout.checkoutLink,
        amount_kobo: body.amount_kobo,
        currency: env.NOMBA_DEFAULT_CURRENCY,
        status: "pending",
        metadata: { nomba_checkout_response: checkout.raw, customer_email: body.customer_email }
      })
      .select("id,order_reference,checkout_link,amount_kobo,currency,status,created_at")
      .single();

    if (error) throw error;
    return created(data);
  } catch (error) {
    return handleApiError(error);
  }
}

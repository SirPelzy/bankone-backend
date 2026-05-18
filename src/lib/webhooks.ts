import { ApiError } from "./errors";
import {
  creditWalletFromFunding,
  recreditWalletAfterTransferFailure,
  reverseWalletFundingCredit
} from "./ledger";
import { enqueueTransferFunding, type BankOneTransaction } from "./transactions";

type SupabaseClientLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

type NombaWebhookPayload = {
  event_type: string;
  requestId?: string;
  request_id?: string;
  data?: {
    tokenizedCardData?: {
      tokenKey?: string;
      cardType?: string;
      cardPan?: string;
      tokenExpiryMonth?: string;
      tokenExpiryYear?: string;
      tokenExpirationDate?: string;
    };
    transaction?: {
      transactionId?: string;
      merchantTxRef?: string;
      transactionAmount?: number;
      type?: string;
    };
    order?: {
      orderReference?: string;
      customerId?: string;
      customerEmail?: string;
      accountId?: string;
      cardLast4Digits?: string;
      cardType?: string;
    };
  };
};

export async function recordWebhookEvent(input: {
  supabase: SupabaseClientLike;
  environment: string;
  provider: "mono" | "nomba";
  eventId: string;
  eventType: string;
  providerRef?: string;
  payload: unknown;
}): Promise<{ duplicate: boolean }> {
  const { error } = await input.supabase.from("webhook_events").insert({
    environment: input.environment,
    provider: input.provider,
    event_id: input.eventId,
    event_type: input.eventType,
    provider_ref: input.providerRef,
    payload: input.payload,
    processed_at: new Date().toISOString()
  });

  if (!error) return { duplicate: false };
  if (String(error.message ?? "").includes("duplicate key")) return { duplicate: true };
  throw new ApiError(500, "webhook_record_failed", "Could not record webhook event.", error);
}

export async function handleNombaWebhook(input: {
  supabase: SupabaseClientLike;
  environment: "test" | "production";
  payload: NombaWebhookPayload;
}) {
  const eventId = input.payload.requestId ?? input.payload.request_id ?? input.payload.data?.transaction?.transactionId;
  if (!eventId) throw new ApiError(400, "webhook_missing_event_id", "Nomba webhook is missing an event ID.");

  const providerRef = input.payload.data?.transaction?.transactionId ?? input.payload.data?.order?.orderReference;
  const event = await recordWebhookEvent({
    supabase: input.supabase,
    environment: input.environment,
    provider: "nomba",
    eventId,
    eventType: input.payload.event_type,
    providerRef,
    payload: input.payload
  });

  if (event.duplicate) return { action: "duplicate_ignored" };

  if (input.payload.event_type === "payment_success") {
    return handleNombaPaymentSuccess(input.supabase, input.environment, input.payload);
  }

  if (["payment_failed", "payment_reversal"].includes(input.payload.event_type)) {
    return handleNombaPaymentFailure(input.supabase, input.environment, input.payload);
  }

  if (input.payload.event_type === "payout_success") {
    return handleNombaPayoutSuccess(input.supabase, input.environment, input.payload);
  }

  if (["payout_failed", "payout_refund"].includes(input.payload.event_type)) {
    return handleNombaPayoutFailure(input.supabase, input.environment, input.payload);
  }

  return { action: "event_recorded_only", event_type: input.payload.event_type };
}

async function handleNombaPaymentSuccess(
  supabase: SupabaseClientLike,
  environment: "test" | "production",
  payload: NombaWebhookPayload
) {
  const orderReference = payload.data?.order?.orderReference;
  if (!orderReference) return { action: "payment_success_missing_order_reference" };

  const cardSession = await findCardSession(supabase, environment, orderReference);
  if (cardSession && payload.data?.tokenizedCardData?.tokenKey) {
    const token = payload.data.tokenizedCardData;
    const cardPan = token.cardPan ?? payload.data.order?.cardLast4Digits ?? "";
    const last4 = cardPan.replace(/\D/g, "").slice(-4);

    await supabase.from("funding_sources").upsert(
      {
        environment,
        user_id: cardSession.user_id,
        provider: "nomba",
        source_type: "card",
        provider_ref: token.tokenKey,
        provider_customer_ref: payload.data.order?.customerId,
        display_name: `${token.cardType ?? payload.data.order?.cardType ?? "Card"} ${last4 ? `•••• ${last4}` : ""}`.trim(),
        card_brand: token.cardType ?? payload.data.order?.cardType,
        card_last4: last4 || null,
        status: "active",
        reliability_score: 100,
        metadata: {
          customer_email: payload.data.order?.customerEmail,
          token_expiry_month: token.tokenExpiryMonth,
          token_expiry_year: token.tokenExpiryYear,
          token_expiration_date: token.tokenExpirationDate,
          tokenization_order_reference: orderReference,
          link_charge_refund_required: true
        }
      },
      { onConflict: "environment,user_id,provider,provider_ref" }
    );

    await supabase
      .from("card_link_sessions")
      .update({
        status: "completed",
        nomba_transaction_id: payload.data.transaction?.transactionId,
        metadata: { webhook_payload: payload }
      })
      .eq("id", cardSession.id);

    return { action: "card_token_saved" };
  }

  const attempt = await findFundingAttempt(supabase, environment, orderReference);
  if (!attempt || attempt.status === "succeeded") {
    return { action: "funding_attempt_not_found_or_already_succeeded" };
  }

  const transaction = await loadTransactionById(supabase, environment, attempt.transaction_id);
  await creditWalletFromFunding({
    supabase,
    environment,
    transactionId: transaction.id,
    userId: transaction.user_id,
    amountKobo: attempt.amount_kobo,
    providerRef: payload.data?.transaction?.transactionId ?? orderReference
  });

  const fundedKobo = transaction.funded_kobo + attempt.amount_kobo;
  const nextStatus = fundedKobo >= transaction.amount_kobo ? "funded" : "partial_funded";

  await supabase.from("funding_attempts").update({ status: "succeeded", raw_response: payload }).eq("id", attempt.id);
  await supabase
    .from("transactions")
    .update({ funded_kobo: fundedKobo, status: nextStatus })
    .eq("id", transaction.id);

  await enqueueTransferFunding(supabase, transaction.id);
  return { action: "funding_credit_posted", transaction_id: transaction.id, status: nextStatus };
}

async function handleNombaPaymentFailure(
  supabase: SupabaseClientLike,
  environment: "test" | "production",
  payload: NombaWebhookPayload
) {
  const orderReference = payload.data?.order?.orderReference;
  if (!orderReference) return { action: "payment_failure_missing_order_reference" };

  const attempt = await findFundingAttempt(supabase, environment, orderReference);
  if (!attempt) return { action: "funding_attempt_not_found" };

  const transaction = await loadTransactionById(supabase, environment, attempt.transaction_id);

  if (payload.event_type === "payment_reversal" && attempt.status === "succeeded") {
    await reverseWalletFundingCredit({
      supabase,
      environment,
      transactionId: transaction.id,
      userId: transaction.user_id,
      amountKobo: attempt.amount_kobo,
      providerRef: payload.data?.transaction?.transactionId ?? orderReference
    });
    await supabase
      .from("transactions")
      .update({
        funded_kobo: Math.max(0, transaction.funded_kobo - attempt.amount_kobo),
        status: "partial_funded",
        failure_reason: "Funding payment was reversed."
      })
      .eq("id", transaction.id);
  }

  await supabase.from("funding_attempts").update({ status: "failed", raw_response: payload }).eq("id", attempt.id);
  if (attempt.funding_source_id) {
    await supabase.from("funding_sources").update({ status: "unreliable" }).eq("id", attempt.funding_source_id);
  }

  await enqueueTransferFunding(supabase, transaction.id);
  return { action: "funding_failure_recorded", transaction_id: transaction.id };
}

async function handleNombaPayoutSuccess(
  supabase: SupabaseClientLike,
  environment: "test" | "production",
  payload: NombaWebhookPayload
) {
  const transaction = await findTransactionFromPayoutPayload(supabase, environment, payload);
  if (!transaction) return { action: "payout_transaction_not_found" };

  await supabase.from("transactions").update({ status: "completed", metadata: { ...transaction.metadata, payout_webhook: payload } }).eq("id", transaction.id);
  return { action: "payout_completed", transaction_id: transaction.id };
}

async function handleNombaPayoutFailure(
  supabase: SupabaseClientLike,
  environment: "test" | "production",
  payload: NombaWebhookPayload
) {
  const transaction = await findTransactionFromPayoutPayload(supabase, environment, payload);
  if (!transaction) return { action: "payout_transaction_not_found" };

  if (transaction.status !== "failed") {
    await recreditWalletAfterTransferFailure({
      supabase,
      environment,
      transactionId: transaction.id,
      userId: transaction.user_id,
      amountKobo: transaction.amount_kobo,
      providerRef: payload.data?.transaction?.transactionId
    });
  }

  await supabase
    .from("transactions")
    .update({
      status: "failed",
      failure_reason: payload.event_type,
      metadata: { ...transaction.metadata, payout_webhook: payload }
    })
    .eq("id", transaction.id);

  return { action: "payout_failed_wallet_recredited", transaction_id: transaction.id };
}

async function findCardSession(supabase: SupabaseClientLike, environment: string, orderReference: string) {
  const { data, error } = await supabase
    .from("card_link_sessions")
    .select("*")
    .eq("environment", environment)
    .eq("order_reference", orderReference)
    .maybeSingle();
  if (error) throw new ApiError(500, "card_session_read_failed", "Could not read card link session.", error);
  return data as null | { id: string; user_id: string };
}

async function findFundingAttempt(supabase: SupabaseClientLike, environment: string, providerRef: string) {
  const { data, error } = await supabase
    .from("funding_attempts")
    .select("*")
    .eq("environment", environment)
    .eq("provider_ref", providerRef)
    .maybeSingle();
  if (error) throw new ApiError(500, "funding_attempt_read_failed", "Could not read funding attempt.", error);
  return data as null | {
    id: string;
    transaction_id: string;
    funding_source_id: string | null;
    amount_kobo: number;
    status: string;
  };
}

async function loadTransactionById(
  supabase: SupabaseClientLike,
  environment: "test" | "production",
  transactionId: string
): Promise<BankOneTransaction> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("environment", environment)
    .eq("id", transactionId)
    .single();
  if (error || !data) throw new ApiError(404, "transaction_not_found", "Transaction was not found.", error);
  return data as BankOneTransaction;
}

async function findTransactionFromPayoutPayload(
  supabase: SupabaseClientLike,
  environment: "test" | "production",
  payload: NombaWebhookPayload
): Promise<BankOneTransaction | null> {
  const providerRef = payload.data?.transaction?.transactionId;
  const merchantTxRef = payload.data?.transaction?.merchantTxRef;

  let query = supabase.from("transactions").select("*").eq("environment", environment);
  if (merchantTxRef) query = query.eq("merchant_tx_ref", merchantTxRef);
  else if (providerRef) query = query.eq("nomba_transfer_id", providerRef);
  else return null;

  const { data, error } = await query.maybeSingle();
  if (error) throw new ApiError(500, "transaction_read_failed", "Could not read transaction.", error);
  return data as BankOneTransaction | null;
}

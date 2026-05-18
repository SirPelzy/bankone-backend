import { ApiError } from "./errors";
import { getEnv } from "./env";
import { makeFundingAttemptKey } from "./idempotency";
import { debitWalletForOutboundTransfer } from "./ledger";
import { chargeNombaTokenizedCard, initiateNombaBankTransfer } from "./providers/nomba";
import type { BankOneTransaction } from "./transactions";

type SupabaseClientLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

type QueueMessage = {
  msg_id: number;
  message: { transaction_id?: string };
};

type FundingSource = {
  id: string;
  user_id: string;
  provider_ref: string;
  status: string;
  reliability_score: number;
  metadata: Record<string, unknown>;
};

type FundingAttempt = {
  id: string;
  status: string;
};

export async function processFundingQueue(supabase: SupabaseClientLike) {
  const { data, error } = await supabase.rpc("read_transfer_funding_messages", {
    p_visibility_timeout: 120,
    p_quantity: 5
  });
  if (error) throw new ApiError(500, "queue_read_failed", "Could not read funding queue.", error);

  const messages = (data ?? []) as QueueMessage[];
  const results = [];

  for (const message of messages) {
    const transactionId = message.message?.transaction_id;
    if (!transactionId) {
      await archiveMessage(supabase, message.msg_id);
      results.push({ msg_id: message.msg_id, status: "archived_invalid_message" });
      continue;
    }

    try {
      const result = await processTransferFundingJob(supabase, transactionId);
      await archiveMessage(supabase, message.msg_id);
      results.push({ msg_id: message.msg_id, transaction_id: transactionId, status: "processed", result });
    } catch (errorForMessage) {
      results.push({
        msg_id: message.msg_id,
        transaction_id: transactionId,
        status: "will_retry",
        error: errorForMessage instanceof Error ? errorForMessage.message : "Unknown error"
      });
    }
  }

  return { processed: results.length, results };
}

async function archiveMessage(supabase: SupabaseClientLike, msgId: number) {
  const { error } = await supabase.rpc("archive_transfer_funding_message", { p_msg_id: msgId });
  if (error) throw new ApiError(500, "queue_archive_failed", "Could not archive funding queue message.", error);
}

export async function processTransferFundingJob(supabase: SupabaseClientLike, transactionId: string) {
  const env = getEnv();
  const transaction = await loadTransaction(supabase, transactionId, env.APP_ENV);

  if (["completed", "processing", "failed", "cancelled"].includes(transaction.status)) {
    return { action: "noop", reason: `status_${transaction.status}` };
  }

  if (transaction.funded_kobo >= transaction.amount_kobo || transaction.status === "funded") {
    return initiateOutboundTransfer(supabase, transaction);
  }

  const pendingAttempt = await loadPendingAttempt(supabase, transaction.id);
  if (pendingAttempt) {
    return { action: "awaiting_provider_webhook", attempt_id: pendingAttempt.id };
  }

  await supabase.from("transactions").update({ status: "funding" }).eq("id", transaction.id).eq("environment", env.APP_ENV);

  const sources = await loadChargeableSources(supabase, transaction.user_id, env.APP_ENV);
  const remainingKobo = transaction.amount_kobo - transaction.funded_kobo;

  for (const source of sources) {
    const attemptNumber = await nextAttemptNumber(supabase, transaction.id, source.id);
    const idempotencyKey = makeFundingAttemptKey(transaction.id, source.id, attemptNumber);
    const orderReference = idempotencyKey.replaceAll(":", "_");

    const { data: attempt, error: insertError } = await supabase
      .from("funding_attempts")
      .insert({
        environment: env.APP_ENV,
        transaction_id: transaction.id,
        funding_source_id: source.id,
        amount_kobo: remainingKobo,
        status: "submitted",
        provider_ref: orderReference,
        idempotency_key: idempotencyKey,
        raw_response: {}
      })
      .select("*")
      .single();

    if (insertError) throw new ApiError(500, "funding_attempt_create_failed", "Could not create funding attempt.", insertError);

    try {
      const charge = await chargeNombaTokenizedCard({
        tokenKey: source.provider_ref,
        orderReference,
        userId: transaction.user_id,
        customerEmail: typeof source.metadata?.customer_email === "string" ? source.metadata.customer_email : undefined,
        amountKobo: remainingKobo,
        idempotencyKey
      });

      await supabase
        .from("funding_attempts")
        .update({ raw_response: { provider_response: charge.raw, provider_transaction_id: charge.providerRef } })
        .eq("id", attempt.id);

      return { action: "submitted_card_charge", attempt_id: attempt.id, amount_kobo: remainingKobo };
    } catch (error) {
      await supabase
        .from("funding_attempts")
        .update({
          status: "failed",
          failure_message: error instanceof Error ? error.message : "Unknown card charge failure"
        })
        .eq("id", attempt.id);

      await supabase
        .from("funding_sources")
        .update({
          status: "unreliable",
          reliability_score: Math.max(0, Number(source.reliability_score) - 20)
        })
        .eq("id", source.id);
    }
  }

  const terminalStatus = transaction.funded_kobo > 0 ? "partial_funded" : "failed";
  await supabase
    .from("transactions")
    .update({
      status: terminalStatus,
      failure_reason: terminalStatus === "failed" ? "No chargeable funding source succeeded." : null
    })
    .eq("id", transaction.id);

  return { action: "exhausted_sources", status: terminalStatus };
}

async function initiateOutboundTransfer(supabase: SupabaseClientLike, transaction: BankOneTransaction) {
  if (transaction.nomba_transfer_id) {
    await supabase.from("transactions").update({ status: "processing" }).eq("id", transaction.id);
    return { action: "already_initiated", provider_ref: transaction.nomba_transfer_id };
  }

  const transfer = await initiateNombaBankTransfer({
    amountKobo: transaction.amount_kobo,
    accountNumber: transaction.recipient_account_number,
    accountName: transaction.recipient_account_name,
    bankCode: transaction.recipient_bank_code,
    merchantTxRef: transaction.merchant_tx_ref,
    narration: transaction.narration ?? undefined
  });

  await debitWalletForOutboundTransfer({
    supabase,
    environment: transaction.environment,
    transactionId: transaction.id,
    userId: transaction.user_id,
    amountKobo: transaction.amount_kobo,
    providerRef: transfer.transferId
  });

  await supabase
    .from("transactions")
    .update({
      status: "processing",
      nomba_transfer_id: transfer.transferId,
      metadata: {
        ...transaction.metadata,
        nomba_initial_transfer_status: transfer.status,
        nomba_transfer_response: transfer.raw
      }
    })
    .eq("id", transaction.id);

  return { action: "initiated_outbound_transfer", provider_ref: transfer.transferId, provider_status: transfer.status };
}

async function loadTransaction(
  supabase: SupabaseClientLike,
  transactionId: string,
  environment: string
): Promise<BankOneTransaction> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .eq("environment", environment)
    .single();
  if (error || !data) throw new ApiError(404, "transaction_not_found", "Transaction was not found.", error);
  return data as BankOneTransaction;
}

async function loadPendingAttempt(supabase: SupabaseClientLike, transactionId: string): Promise<FundingAttempt | null> {
  const { data, error } = await supabase
    .from("funding_attempts")
    .select("id,status")
    .eq("transaction_id", transactionId)
    .eq("status", "submitted")
    .maybeSingle();
  if (error) throw new ApiError(500, "funding_attempt_read_failed", "Could not read funding attempts.", error);
  return data as FundingAttempt | null;
}

async function loadChargeableSources(
  supabase: SupabaseClientLike,
  userId: string,
  environment: string
): Promise<FundingSource[]> {
  const { data, error } = await supabase
    .from("funding_sources")
    .select("id,user_id,provider_ref,status,reliability_score,metadata")
    .eq("environment", environment)
    .eq("user_id", userId)
    .eq("provider", "nomba")
    .eq("source_type", "card")
    .eq("status", "active")
    .order("reliability_score", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new ApiError(500, "funding_sources_read_failed", "Could not read funding sources.", error);
  return (data ?? []) as FundingSource[];
}

async function nextAttemptNumber(supabase: SupabaseClientLike, transactionId: string, sourceId: string): Promise<number> {
  const { count, error } = await supabase
    .from("funding_attempts")
    .select("id", { count: "exact", head: true })
    .eq("transaction_id", transactionId)
    .eq("funding_source_id", sourceId);
  if (error) throw new ApiError(500, "funding_attempt_count_failed", "Could not count funding attempts.", error);
  return (count ?? 0) + 1;
}

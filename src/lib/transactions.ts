import { randomUUID } from "crypto";
import { ApiError } from "./errors";
import { makeMerchantTransferRef } from "./idempotency";
import { ensureWalletAccount, getWalletBalanceKobo } from "./ledger";

type SupabaseClientLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

export type BankOneTransaction = {
  id: string;
  environment: "test" | "production";
  user_id: string;
  amount_kobo: number;
  funded_kobo: number;
  status: "pending" | "funding" | "partial_funded" | "funded" | "processing" | "completed" | "failed" | "cancelled";
  recipient_bank_code: string;
  recipient_account_number: string;
  recipient_account_name: string;
  narration?: string | null;
  merchant_tx_ref: string;
  nomba_transfer_id?: string | null;
  failure_reason?: string | null;
  metadata: Record<string, unknown>;
};

export async function enqueueTransferFunding(supabase: SupabaseClientLike, transactionId: string): Promise<number> {
  const { data, error } = await supabase.rpc("enqueue_transfer_funding", {
    p_transaction_id: transactionId
  });
  if (error) throw new ApiError(500, "queue_enqueue_failed", "Could not enqueue transfer funding job.", error);
  return Number(data);
}

export async function createTransfer(input: {
  supabase: SupabaseClientLike;
  environment: "test" | "production";
  userId: string;
  amountKobo: number;
  recipient: {
    bank_code: string;
    account_number: string;
    account_name: string;
  };
  narration?: string;
}) {
  const id = randomUUID();
  const merchantTxRef = makeMerchantTransferRef(id);

  await ensureWalletAccount(input.supabase, input.userId, input.environment);

  const { data, error } = await input.supabase
    .from("transactions")
    .insert({
      id,
      environment: input.environment,
      user_id: input.userId,
      amount_kobo: input.amountKobo,
      funded_kobo: 0,
      status: "pending",
      recipient_bank_code: input.recipient.bank_code,
      recipient_account_number: input.recipient.account_number,
      recipient_account_name: input.recipient.account_name,
      narration: input.narration,
      merchant_tx_ref: merchantTxRef,
      metadata: {}
    })
    .select("*")
    .single();

  if (error) throw new ApiError(500, "transfer_create_failed", "Could not create transfer.", error);

  await enqueueTransferFunding(input.supabase, id);
  return data as BankOneTransaction;
}

export async function getTransactionForUser(input: {
  supabase: SupabaseClientLike;
  environment: "test" | "production";
  userId: string;
  transactionId: string;
}) {
  const { data, error } = await input.supabase
    .from("transactions")
    .select("*")
    .eq("id", input.transactionId)
    .eq("environment", input.environment)
    .eq("user_id", input.userId)
    .single();

  if (error || !data) {
    throw new ApiError(404, "transaction_not_found", "Transaction was not found.");
  }

  const walletBalanceKobo = await getWalletBalanceKobo(input.supabase, input.userId, input.environment);
  const transaction = data as BankOneTransaction;

  return {
    ...transaction,
    remaining_kobo: transaction.amount_kobo - transaction.funded_kobo,
    wallet_balance_kobo: walletBalanceKobo
  };
}

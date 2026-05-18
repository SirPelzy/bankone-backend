import { randomUUID } from "crypto";
import { ApiError } from "./errors";

type SupabaseClientLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

type LedgerEntryInput = {
  account_id: string;
  signed_amount_kobo: number;
  description: string;
  provider_ref?: string;
  metadata?: Record<string, unknown>;
};

export async function ensureWalletAccount(supabase: SupabaseClientLike, userId: string, environment: string): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_wallet_account", {
    p_user_id: userId,
    p_environment: environment
  });
  if (error) throw new ApiError(500, "wallet_account_failed", "Could not ensure wallet account.", error);
  return data as string;
}

export async function ensurePlatformAccount(
  supabase: SupabaseClientLike,
  environment: string,
  accountType: "platform_clearing" | "external_settlement"
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_platform_account", {
    p_environment: environment,
    p_account_type: accountType
  });
  if (error) throw new ApiError(500, "platform_account_failed", "Could not ensure platform account.", error);
  return data as string;
}

export async function postLedgerGroup(input: {
  supabase: SupabaseClientLike;
  environment: string;
  transactionId: string;
  status?: "pending" | "posted" | "reversed";
  entries: LedgerEntryInput[];
}) {
  const total = input.entries.reduce((sum, entry) => sum + entry.signed_amount_kobo, 0);
  if (total !== 0) {
    throw new ApiError(500, "unbalanced_ledger_group", "Ledger group must balance to zero.", { total });
  }

  const groupId = randomUUID();
  const rows = input.entries.map((entry) => ({
    environment: input.environment,
    transaction_id: input.transactionId,
    account_id: entry.account_id,
    group_id: groupId,
    signed_amount_kobo: entry.signed_amount_kobo,
    status: input.status ?? "posted",
    description: entry.description,
    provider_ref: entry.provider_ref,
    metadata: entry.metadata ?? {}
  }));

  const { error } = await input.supabase.from("ledger_entries").insert(rows);
  if (error) throw new ApiError(500, "ledger_post_failed", "Could not post ledger entries.", error);

  return groupId;
}

export async function creditWalletFromFunding(input: {
  supabase: SupabaseClientLike;
  environment: string;
  transactionId: string;
  userId: string;
  amountKobo: number;
  providerRef?: string;
}) {
  const walletAccountId = await ensureWalletAccount(input.supabase, input.userId, input.environment);
  const clearingAccountId = await ensurePlatformAccount(input.supabase, input.environment, "platform_clearing");
  return postLedgerGroup({
    supabase: input.supabase,
    environment: input.environment,
    transactionId: input.transactionId,
    entries: [
      {
        account_id: walletAccountId,
        signed_amount_kobo: input.amountKobo,
        description: "Wallet credited from card funding",
        provider_ref: input.providerRef
      },
      {
        account_id: clearingAccountId,
        signed_amount_kobo: -input.amountKobo,
        description: "Platform clearing liability for card funding",
        provider_ref: input.providerRef
      }
    ]
  });
}

export async function debitWalletForOutboundTransfer(input: {
  supabase: SupabaseClientLike;
  environment: string;
  transactionId: string;
  userId: string;
  amountKobo: number;
  providerRef?: string;
}) {
  const walletAccountId = await ensureWalletAccount(input.supabase, input.userId, input.environment);
  const settlementAccountId = await ensurePlatformAccount(input.supabase, input.environment, "external_settlement");
  return postLedgerGroup({
    supabase: input.supabase,
    environment: input.environment,
    transactionId: input.transactionId,
    entries: [
      {
        account_id: walletAccountId,
        signed_amount_kobo: -input.amountKobo,
        description: "Wallet debited for outbound transfer",
        provider_ref: input.providerRef
      },
      {
        account_id: settlementAccountId,
        signed_amount_kobo: input.amountKobo,
        description: "External settlement pending",
        provider_ref: input.providerRef
      }
    ]
  });
}

export async function recreditWalletAfterTransferFailure(input: {
  supabase: SupabaseClientLike;
  environment: string;
  transactionId: string;
  userId: string;
  amountKobo: number;
  providerRef?: string;
}) {
  const walletAccountId = await ensureWalletAccount(input.supabase, input.userId, input.environment);
  const settlementAccountId = await ensurePlatformAccount(input.supabase, input.environment, "external_settlement");
  return postLedgerGroup({
    supabase: input.supabase,
    environment: input.environment,
    transactionId: input.transactionId,
    entries: [
      {
        account_id: walletAccountId,
        signed_amount_kobo: input.amountKobo,
        description: "Wallet re-credited after failed outbound transfer",
        provider_ref: input.providerRef
      },
      {
        account_id: settlementAccountId,
        signed_amount_kobo: -input.amountKobo,
        description: "External settlement reversed",
        provider_ref: input.providerRef
      }
    ]
  });
}

export async function reverseWalletFundingCredit(input: {
  supabase: SupabaseClientLike;
  environment: string;
  transactionId: string;
  userId: string;
  amountKobo: number;
  providerRef?: string;
}) {
  const walletAccountId = await ensureWalletAccount(input.supabase, input.userId, input.environment);
  const clearingAccountId = await ensurePlatformAccount(input.supabase, input.environment, "platform_clearing");
  return postLedgerGroup({
    supabase: input.supabase,
    environment: input.environment,
    transactionId: input.transactionId,
    entries: [
      {
        account_id: walletAccountId,
        signed_amount_kobo: -input.amountKobo,
        description: "Wallet funding credit reversed",
        provider_ref: input.providerRef
      },
      {
        account_id: clearingAccountId,
        signed_amount_kobo: input.amountKobo,
        description: "Platform clearing reversal",
        provider_ref: input.providerRef
      }
    ]
  });
}

export async function getWalletBalanceKobo(supabase: SupabaseClientLike, userId: string, environment: string): Promise<number> {
  const walletAccountId = await ensureWalletAccount(supabase, userId, environment);
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("signed_amount_kobo")
    .eq("account_id", walletAccountId)
    .eq("environment", environment);

  if (error) throw new ApiError(500, "wallet_balance_failed", "Could not read wallet balance.", error);

  return (data as Array<{ signed_amount_kobo: number }>).reduce(
    (sum, entry) => sum + Number(entry.signed_amount_kobo),
    0
  );
}

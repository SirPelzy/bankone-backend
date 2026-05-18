import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { handleApiError, ok } from "@/lib/http";
import { getWalletBalanceKobo } from "@/lib/ledger";
import { fetchMonoBalance } from "@/lib/providers/mono";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const env = getEnv();
    const user = await requireUser(request);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("funding_sources")
      .select("id,provider_ref,display_name,institution_name,account_mask,status")
      .eq("environment", env.APP_ENV)
      .eq("user_id", user.id)
      .eq("provider", "mono")
      .eq("source_type", "bank_account")
      .eq("status", "active");

    if (error) throw error;

    const accounts = await Promise.all(
      (data ?? []).map(async (source) => {
        try {
          const balance = await fetchMonoBalance(source.provider_ref);
          return {
            source_id: source.id,
            display_name: source.display_name,
            institution_name: source.institution_name,
            account_mask: source.account_mask,
            status: "available",
            ...balance
          };
        } catch (balanceError) {
          return {
            source_id: source.id,
            display_name: source.display_name,
            institution_name: source.institution_name,
            account_mask: source.account_mask,
            status: "unavailable",
            error: balanceError instanceof Error ? balanceError.message : "Could not fetch balance"
          };
        }
      })
    );

    const advisoryTotalKobo = accounts.reduce(
      (sum, account) => sum + ("balanceKobo" in account ? Number(account.balanceKobo) : 0),
      0
    );
    const walletBalanceKobo = await getWalletBalanceKobo(supabase, user.id, env.APP_ENV);

    return ok({
      advisory: true,
      advisory_total_kobo: advisoryTotalKobo,
      wallet_balance_kobo: walletBalanceKobo,
      accounts
    });
  } catch (error) {
    return handleApiError(error);
  }
}

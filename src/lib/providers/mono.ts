import { ApiError } from "../errors";
import { getEnv } from "../env";

type MonoAccountAuthResponse = {
  id?: string;
  account?: { id?: string; _id?: string };
  data?: { id?: string; _id?: string; account?: { id?: string; _id?: string } };
};

type MonoBalanceResponse = {
  data?: {
    balance?: number;
    available_balance?: number;
    currency?: string;
  };
  balance?: number;
  available_balance?: number;
  currency?: string;
};

async function monoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const env = getEnv();
  const response = await fetch(`${env.MONO_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "mono-sec-key": env.MONO_SECRET_KEY,
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };

  if (!response.ok) {
    throw new ApiError(
      response.status,
      "mono_request_failed",
      payload.message ?? payload.error ?? "Mono request failed.",
      payload
    );
  }

  return payload;
}

export async function exchangeMonoAuthCode(authCode: string): Promise<{ accountId: string; raw: unknown }> {
  const payload = await monoRequest<MonoAccountAuthResponse>("/v2/accounts/auth", {
    method: "POST",
    body: JSON.stringify({ code: authCode })
  });

  const accountId =
    payload.data?.account?.id ??
    payload.data?.account?._id ??
    payload.data?.id ??
    payload.data?._id ??
    payload.account?.id ??
    payload.account?._id ??
    payload.id;

  if (!accountId) {
    throw new ApiError(502, "mono_missing_account_id", "Mono did not return an account ID.", payload);
  }

  return { accountId, raw: payload };
}

export async function fetchMonoBalance(accountId: string): Promise<{
  balanceKobo: number;
  availableBalanceKobo: number;
  currency: string;
  raw: unknown;
}> {
  const payload = await monoRequest<MonoBalanceResponse>(`/v2/accounts/${accountId}/balance`, {
    method: "GET"
  });

  const balance = payload.data?.balance ?? payload.balance ?? 0;
  const available = payload.data?.available_balance ?? payload.available_balance ?? balance;
  const currency = payload.data?.currency ?? payload.currency ?? "NGN";

  return {
    balanceKobo: Math.round(Number(balance) * 100),
    availableBalanceKobo: Math.round(Number(available) * 100),
    currency,
    raw: payload
  };
}

export function verifyMonoWebhook(request: Request): boolean {
  const env = getEnv();
  return request.headers.get("mono-webhook-secret") === env.MONO_WEBHOOK_SECRET;
}

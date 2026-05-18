import { createHmac, timingSafeEqual } from "crypto";
import { ApiError } from "../errors";
import { getEnv } from "../env";
import { koboToNairaString } from "../money";

type NombaAuthResponse = {
  data?: {
    access_token?: string;
    refresh_token?: string;
    expiresAt?: string;
  };
  description?: string;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getNombaAccessToken(): Promise<string> {
  const env = getEnv();
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const response = await fetch(`${env.NOMBA_BASE_URL}/v1/auth/token/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accountId: env.NOMBA_ACCOUNT_ID
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.NOMBA_CLIENT_ID,
      client_secret: env.NOMBA_CLIENT_SECRET
    })
  });

  const payload = (await response.json().catch(() => ({}))) as NombaAuthResponse;
  if (!response.ok || !payload.data?.access_token) {
    throw new ApiError(response.status || 502, "nomba_auth_failed", payload.description ?? "Nomba authentication failed.", payload);
  }

  cachedToken = {
    token: payload.data.access_token,
    expiresAt: payload.data.expiresAt ? new Date(payload.data.expiresAt).getTime() : now + 25 * 60 * 1000
  };

  return cachedToken.token;
}

async function nombaRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const env = getEnv();
  const token = await getNombaAccessToken();
  const response = await fetch(`${env.NOMBA_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      accountId: env.NOMBA_ACCOUNT_ID,
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => ({}))) as T & {
    description?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new ApiError(
      response.status,
      "nomba_request_failed",
      payload.description ?? payload.message ?? "Nomba request failed.",
      payload
    );
  }

  return payload;
}

export async function createNombaTokenizingCheckout(input: {
  orderReference: string;
  userId: string;
  customerEmail: string;
  amountKobo: number;
}): Promise<{ checkoutLink: string; raw: unknown }> {
  const env = getEnv();
  const payload = await nombaRequest<{
    data?: { checkoutLink?: string; orderReference?: string };
  }>("/v1/checkout/order", {
    method: "POST",
    body: JSON.stringify({
      order: {
        orderReference: input.orderReference,
        customerId: input.userId,
        customerEmail: input.customerEmail,
        callbackUrl: env.NOMBA_CHECKOUT_CALLBACK_URL,
        amount: koboToNairaString(input.amountKobo),
        currency: env.NOMBA_DEFAULT_CURRENCY,
        accountId: env.NOMBA_ACCOUNT_ID,
        allowedPaymentMethods: ["Card"]
      },
      tokenizeCard: true
    })
  });

  if (!payload.data?.checkoutLink) {
    throw new ApiError(502, "nomba_missing_checkout_link", "Nomba did not return a checkout link.", payload);
  }

  return { checkoutLink: payload.data.checkoutLink, raw: payload };
}

export async function chargeNombaTokenizedCard(input: {
  tokenKey: string;
  orderReference: string;
  userId: string;
  customerEmail?: string;
  amountKobo: number;
  idempotencyKey: string;
}): Promise<{ providerRef?: string; raw: unknown }> {
  const env = getEnv();
  const payload = await nombaRequest<{
    data?: { transactionId?: string; status?: string; message?: string };
  }>("/v1/checkout/tokenized-card-payment", {
    method: "POST",
    headers: {
      "X-Idempotent-key": input.idempotencyKey
    },
    body: JSON.stringify({
      tokenKey: input.tokenKey,
      order: {
        orderReference: input.orderReference,
        customerId: input.userId,
        customerEmail: input.customerEmail ?? "",
        callbackUrl: env.NOMBA_WEBHOOK_URL,
        amount: koboToNairaString(input.amountKobo),
        currency: env.NOMBA_DEFAULT_CURRENCY,
        accountId: env.NOMBA_ACCOUNT_ID
      }
    })
  });

  return { providerRef: payload.data?.transactionId, raw: payload };
}

export async function initiateNombaBankTransfer(input: {
  amountKobo: number;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  merchantTxRef: string;
  narration?: string;
}): Promise<{ transferId: string; status: string; raw: unknown }> {
  const env = getEnv();
  const payload = await nombaRequest<{
    data?: { id?: string; status?: string };
  }>("/v2/transfers/bank", {
    method: "POST",
    headers: {
      "X-Idempotent-key": input.merchantTxRef
    },
    body: JSON.stringify({
      amount: Number(koboToNairaString(input.amountKobo)),
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      bankCode: input.bankCode,
      merchantTxRef: input.merchantTxRef,
      senderName: env.NOMBA_TRANSFER_SENDER_NAME,
      narration: input.narration
    })
  });

  if (!payload.data?.id) {
    throw new ApiError(502, "nomba_missing_transfer_id", "Nomba did not return a transfer ID.", payload);
  }

  return { transferId: payload.data.id, status: payload.data.status ?? "UNKNOWN", raw: payload };
}

export function verifyNombaWebhookSignature(rawBody: string, headers: Headers): boolean {
  const env = getEnv();
  const signature = headers.get("nomba-signature") ?? headers.get("nomba-sig-value");
  const timestamp = headers.get("nomba-timestamp");
  if (!signature || !timestamp) return false;

  let payload: {
    event_type?: string;
    requestId?: string;
    request_id?: string;
    data?: {
      merchant?: { userId?: string; walletId?: string };
      transaction?: {
        transactionId?: string;
        type?: string;
        time?: string;
        responseCode?: string | null;
      };
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return false;
  }

  const transaction = payload.data?.transaction;
  const merchant = payload.data?.merchant;
  const responseCode = transaction?.responseCode ?? "";
  const signedPayload = [
    payload.event_type,
    payload.requestId ?? payload.request_id,
    merchant?.userId,
    merchant?.walletId,
    transaction?.transactionId,
    transaction?.type,
    transaction?.time,
    responseCode,
    timestamp
  ].join(":");

  const expected = createHmac("sha256", env.NOMBA_WEBHOOK_SIGNATURE_KEY)
    .update(signedPayload)
    .digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

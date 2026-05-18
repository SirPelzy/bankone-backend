import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyNombaWebhookSignature } from "./nomba";
import { installTestEnv } from "../test-env";

describe("nomba webhook verification", () => {
  it("validates Nomba's HMAC signature format", () => {
    installTestEnv();

    const timestamp = "2026-01-01T10:00:00Z";
    const payload = {
      event_type: "payment_success",
      requestId: "req_123",
      data: {
        merchant: {
          userId: "merchant_user",
          walletId: "wallet_123"
        },
        transaction: {
          transactionId: "txn_123",
          type: "online_checkout",
          time: "2026-01-01T09:59:58Z",
          responseCode: ""
        }
      }
    };

    const signedPayload = [
      payload.event_type,
      payload.requestId,
      payload.data.merchant.userId,
      payload.data.merchant.walletId,
      payload.data.transaction.transactionId,
      payload.data.transaction.type,
      payload.data.transaction.time,
      payload.data.transaction.responseCode,
      timestamp
    ].join(":");

    const signature = createHmac("sha256", "nomba_webhook_secret").update(signedPayload).digest("base64");
    const headers = new Headers({
      "nomba-signature": signature,
      "nomba-timestamp": timestamp
    });

    expect(verifyNombaWebhookSignature(JSON.stringify(payload), headers)).toBe(true);
  });
});

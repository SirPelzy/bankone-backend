import { randomUUID } from "crypto";

export function makeMerchantTransferRef(transactionId: string): string {
  return `bankone_trf_${transactionId.replaceAll("-", "")}`;
}

export function makeFundingAttemptKey(transactionId: string, sourceId: string, attemptNumber: number): string {
  return `funding:${transactionId}:${sourceId}:${attemptNumber}`;
}

export function makeCardOrderReference(userId: string): string {
  return `bankone_card_${userId.replaceAll("-", "").slice(0, 12)}_${randomUUID().replaceAll("-", "")}`;
}

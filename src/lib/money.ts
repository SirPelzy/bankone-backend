import { ApiError } from "./errors";

export function koboToNairaString(amountKobo: number | bigint): string {
  const value = BigInt(amountKobo);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const naira = absolute / 100n;
  const kobo = absolute % 100n;
  return `${sign}${naira}.${kobo.toString().padStart(2, "0")}`;
}

export function assertPositiveKobo(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ApiError(400, "invalid_amount", "Amount must be a positive integer in kobo.");
  }
  return value;
}

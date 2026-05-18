import { z } from "zod";

export const linkBankSchema = z.object({
  auth_code: z.string().min(1)
});

export const createCardCheckoutSchema = z.object({
  customer_email: z.string().email(),
  amount_kobo: z.number().int().positive().default(5000)
});

export const createTransferSchema = z.object({
  amount_kobo: z.number().int().positive(),
  recipient: z.object({
    bank_code: z.string().min(2),
    account_number: z.string().min(10),
    account_name: z.string().min(2)
  }),
  narration: z.string().max(120).optional()
});

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

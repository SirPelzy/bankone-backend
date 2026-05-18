import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { postLedgerGroup } from "./ledger";

describe("ledger", () => {
  it("rejects unbalanced ledger groups", async () => {
    await expect(
      postLedgerGroup({
        supabase: {
          rpc: async () => ({ data: null, error: null }),
          from: () => ({ insert: async () => ({ error: null }) })
        },
        environment: "test",
        transactionId: "00000000-0000-0000-0000-000000000001",
        entries: [
          {
            account_id: "00000000-0000-0000-0000-000000000002",
            signed_amount_kobo: 100,
            description: "one-sided"
          }
        ]
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("posts balanced ledger groups", async () => {
    const inserted: unknown[] = [];

    const groupId = await postLedgerGroup({
      supabase: {
        rpc: async () => ({ data: null, error: null }),
        from: () => ({
          insert: async (rows: unknown[]) => {
            inserted.push(...rows);
            return { error: null };
          }
        })
      },
      environment: "test",
      transactionId: "00000000-0000-0000-0000-000000000001",
      entries: [
        {
          account_id: "00000000-0000-0000-0000-000000000002",
          signed_amount_kobo: 100,
          description: "debit"
        },
        {
          account_id: "00000000-0000-0000-0000-000000000003",
          signed_amount_kobo: -100,
          description: "credit"
        }
      ]
    });

    expect(groupId).toHaveLength(36);
    expect(inserted).toHaveLength(2);
  });
});

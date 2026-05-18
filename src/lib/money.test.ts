import { describe, expect, it } from "vitest";
import { koboToNairaString } from "./money";

describe("money", () => {
  it("formats integer kobo as decimal naira", () => {
    expect(koboToNairaString(0)).toBe("0.00");
    expect(koboToNairaString(50)).toBe("0.50");
    expect(koboToNairaString(40000000)).toBe("400000.00");
  });
});

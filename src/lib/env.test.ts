import { describe, expect, it } from "vitest";
import { getEnv } from "./env";
import { installTestEnv } from "./test-env";

describe("env", () => {
  it("validates the required runtime environment", () => {
    installTestEnv();
    expect(getEnv().APP_ENV).toBe("test");
    expect(getEnv().NOMBA_DEFAULT_CURRENCY).toBe("NGN");
  });
});

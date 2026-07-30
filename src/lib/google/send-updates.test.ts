import { describe, it, expect } from "vitest";
import { resolveSendUpdates } from "./config";

describe("resolveSendUpdates (E4 central policy)", () => {
  it("accepts the valid policies", () => {
    expect(resolveSendUpdates("none")).toBe("none");
    expect(resolveSendUpdates("all")).toBe("all");
    expect(resolveSendUpdates("externalOnly")).toBe("externalOnly");
  });

  it("defaults to 'none' for unset or invalid values", () => {
    expect(resolveSendUpdates(undefined)).toBe("none");
    expect(resolveSendUpdates("")).toBe("none");
    expect(resolveSendUpdates("ALL")).toBe("none");
    expect(resolveSendUpdates("everyone")).toBe("none");
  });
});

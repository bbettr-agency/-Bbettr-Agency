import { describe, it, expect } from "vitest";
import { expandGrantKeys, BUNDLES } from "./bundles";
import { canonicalEffectHash } from "./hash";
import { isIndependentlyVerified, resolveVerification } from "./verification";
import { getCapability, CAPABILITY_REGISTRY } from "./capabilities";
import { GRANT_JARVIS_USE, GRANT_JARVIS_APPROVE } from "./constants";

describe("bundles.expandGrantKeys", () => {
  it("expands a founder bundle to its capability keys (incl. approval authority)", () => {
    const keys = expandGrantKeys(["bundle:founder"]);
    expect(keys.has(GRANT_JARVIS_USE)).toBe(true);
    expect(keys.has(GRANT_JARVIS_APPROVE)).toBe(true);
    expect(keys.has("portal.tasks.write")).toBe(true);
  });
  it("readonly_staff has NO approval authority (narrower future staff grant)", () => {
    const keys = expandGrantKeys(["bundle:readonly_staff"]);
    expect(keys.has("portal.read")).toBe(true);
    expect(keys.has(GRANT_JARVIS_APPROVE)).toBe(false);
    expect(keys.has("portal.tasks.write")).toBe(false);
  });
  it("unknown bundle expands to nothing (fail-closed); passes through raw keys", () => {
    expect(expandGrantKeys(["bundle:does_not_exist"]).size).toBe(0);
    expect(expandGrantKeys(["portal.read"]).has("portal.read")).toBe(true);
  });
});

describe("hash.canonicalEffectHash", () => {
  it("is stable across key order and distinguishes different content", () => {
    const a = canonicalEffectHash({ to: "x@y.com", body: "hi", subject: "s" });
    const b = canonicalEffectHash({ body: "hi", subject: "s", to: "x@y.com" });
    expect(a).toBe(b);
    expect(a).not.toBe(canonicalEffectHash({ to: "x@y.com", body: "hi!", subject: "s" }));
  });
});

describe("verification", () => {
  it("only 'verified' + evidence counts as independently verified", () => {
    expect(isIndependentlyVerified({ state: "verified", evidence: { ok: true } })).toBe(true);
    expect(isIndependentlyVerified({ state: "verified" })).toBe(false); // no evidence
    for (const s of ["reported", "pending", "failed", "unavailable", "not_required"] as const) {
      expect(isIndependentlyVerified({ state: s, evidence: { ok: true } })).toBe(false);
    }
  });
  it("no required check → not_required; required with NO adapter → unavailable (never success)", async () => {
    expect((await resolveVerification(null, {})).state).toBe("not_required");
    expect((await resolveVerification("github.deploy", {})).state).toBe("unavailable");
  });
});

describe("capability registry", () => {
  it("has exactly the Foundation-1 capabilities and no god-tools", () => {
    const ids = Object.keys(CAPABILITY_REGISTRY).sort();
    expect(ids).toEqual(
      ["integrations.read_deployment_state", "jarvis.ping", "portal.propose_internal_task", "portal.read_task_counts"].sort()
    );
    expect(getCapability("execute_sql")).toBeNull();
    expect(getCapability("call_any_api")).toBeNull();
  });
  it("propose_internal_task validates title", () => {
    const c = getCapability("portal.propose_internal_task")!;
    expect(c.riskClass).toBe("confirm");
    expect(c.parse({ title: "  Do the thing  " })).toMatchObject({ ok: true, args: { title: "Do the thing" } });
    expect(c.parse({}).ok).toBe(false);
    expect(c.parse({ title: "x".repeat(201) }).ok).toBe(false);
  });
  it("read_deployment_state rejects a non-uuid clientId (no trust of shaped input)", () => {
    const c = getCapability("integrations.read_deployment_state")!;
    expect(c.parse({ clientId: "not-a-uuid" }).ok).toBe(false);
    expect(c.parse({}).ok).toBe(true);
  });
});

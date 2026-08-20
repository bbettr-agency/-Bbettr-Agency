import { describe, it, expect } from "vitest";
import { deriveWebsiteState, isStorableUrl, hasWebsite } from "./website-state";

describe("deriveWebsiteState — one source of truth, live wins", () => {
  it("is 'none' when neither URL is set", () => {
    const v = deriveWebsiteState({});
    expect(v.state).toBe("none");
    expect(v.url).toBeNull();
  });

  it("treats blank/whitespace as absent", () => {
    expect(deriveWebsiteState({ previewUrl: "   ", liveUrl: "" }).state).toBe("none");
  });

  it("is 'preview' when only a preview URL is set", () => {
    const v = deriveWebsiteState({ previewUrl: "https://preview.test/site" });
    expect(v.state).toBe("preview");
    expect(v.url).toBe("https://preview.test/site");
    expect(v.liveUrl).toBeNull();
  });

  it("is 'live' when a live URL is set", () => {
    const v = deriveWebsiteState({ liveUrl: "https://client.co.za" });
    expect(v.state).toBe("live");
    expect(v.url).toBe("https://client.co.za");
  });

  it("prefers live over preview when both exist", () => {
    const v = deriveWebsiteState({
      previewUrl: "https://preview.test/site",
      liveUrl: "https://client.co.za",
    });
    expect(v.state).toBe("live");
    expect(v.url).toBe("https://client.co.za");
    // Both are still exposed for callers that want to show each.
    expect(v.previewUrl).toBe("https://preview.test/site");
  });
});

describe("hasWebsite — the client card render decision (Slice 2D regression)", () => {
  it("renders for a preview-only client (the reported bug)", () => {
    const v = deriveWebsiteState({ previewUrl: "https://preview.test/imatec" });
    expect(v.state).toBe("preview");
    expect(hasWebsite(v)).toBe(true);
  });

  it("renders for a live client, with live taking precedence over preview", () => {
    const v = deriveWebsiteState({
      previewUrl: "https://preview.test/imatec",
      liveUrl: "https://imatec.co.za",
    });
    expect(v.state).toBe("live");
    expect(v.url).toBe("https://imatec.co.za");
    expect(hasWebsite(v)).toBe(true);
  });

  it("does NOT render when neither URL is set", () => {
    expect(hasWebsite(deriveWebsiteState({}))).toBe(false);
    expect(hasWebsite(deriveWebsiteState({ previewUrl: "  ", liveUrl: "" }))).toBe(false);
  });
});

describe("isStorableUrl — validation for the admin setter", () => {
  it("allows empty (clears the field)", () => {
    expect(isStorableUrl("")).toBe(true);
    expect(isStorableUrl("   ")).toBe(true);
  });

  it("accepts http and https URLs", () => {
    expect(isStorableUrl("https://a.co.za")).toBe(true);
    expect(isStorableUrl("http://preview.test/x")).toBe(true);
  });

  it("rejects non-http(s) or malformed values", () => {
    expect(isStorableUrl("ftp://a.co.za")).toBe(false);
    expect(isStorableUrl("javascript:alert(1)")).toBe(false);
    expect(isStorableUrl("not a url")).toBe(false);
    expect(isStorableUrl("example.com")).toBe(false); // no scheme
  });
});

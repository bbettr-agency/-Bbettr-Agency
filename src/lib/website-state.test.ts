import { describe, it, expect } from "vitest";
import { deriveWebsiteState, isStorableUrl, hasWebsite } from "./website-state";

describe("deriveWebsiteState — project stages are canonical (CX1)", () => {
  it("is 'none' when neither URL is set", () => {
    const v = deriveWebsiteState({});
    expect(v.state).toBe("none");
    expect(v.url).toBeNull();
  });

  it("treats blank/whitespace as absent", () => {
    expect(deriveWebsiteState({ previewUrl: "   ", liveUrl: "" }).state).toBe("none");
  });

  it("is 'preview' (In Development) when only a preview URL is set and not launched", () => {
    const v = deriveWebsiteState({ previewUrl: "https://preview.test/site" });
    expect(v.state).toBe("preview");
    expect(v.url).toBe("https://preview.test/site");
    expect(v.dataWarning).toBeUndefined();
  });

  it("is 'live' ONLY when the project has launched", () => {
    const v = deriveWebsiteState({ liveUrl: "https://client.co.za", launched: true });
    expect(v.state).toBe("live");
    expect(v.url).toBe("https://client.co.za");
  });

  it("launched with only a preview URL is still 'live', opening the preview URL", () => {
    const v = deriveWebsiteState({ previewUrl: "https://preview.test/site", launched: true });
    expect(v.state).toBe("live");
    expect(v.url).toBe("https://preview.test/site");
  });

  it("a live URL BEFORE Launch completion is NOT live (shows In Development + a data warning)", () => {
    const v = deriveWebsiteState({ liveUrl: "https://client.co.za", launched: false });
    expect(v.state).toBe("preview"); // In Development, not Live
    expect(v.url).toBe("https://client.co.za"); // still openable as a CTA
    expect(v.dataWarning).toBe("live_url_without_launch");
  });

  it("both URLs before launch → In Development (preview URL as CTA) + warning", () => {
    const v = deriveWebsiteState({
      previewUrl: "https://preview.test/site",
      liveUrl: "https://client.co.za",
      launched: false,
    });
    expect(v.state).toBe("preview");
    expect(v.url).toBe("https://preview.test/site");
    expect(v.dataWarning).toBe("live_url_without_launch");
  });

  it("launched=undefined defaults to not-launched", () => {
    expect(deriveWebsiteState({ liveUrl: "https://client.co.za" }).state).toBe("preview");
  });
});

describe("hasWebsite — the client card render decision", () => {
  it("renders for a preview-only client", () => {
    expect(hasWebsite(deriveWebsiteState({ previewUrl: "https://preview.test/imatec" }))).toBe(true);
  });

  it("renders for a launched client", () => {
    const v = deriveWebsiteState({ liveUrl: "https://imatec.co.za", launched: true });
    expect(v.state).toBe("live");
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

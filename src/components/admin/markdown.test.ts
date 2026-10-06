import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline, safeHref, type MdInline } from "./markdown";

/** Flatten an inline tree to its visible text (what the reader would see). */
function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.value : inlineText(n.children)))
    .join("");
}

describe("markdown parser — safety", () => {
  it("renders raw HTML as literal text, never as markup", () => {
    const blocks = parseMarkdown("<script>alert('x')</script> and <b>hi</b>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    if (blocks[0].type !== "paragraph") throw new Error("expected paragraph");
    // The ONLY node kinds are text/bold/italic/link — no html node exists, so the
    // angle brackets survive as plain text and can never become real DOM markup.
    const flat = inlineText(blocks[0].lines[0]);
    expect(flat).toContain("<script>");
    expect(flat).toContain("</script>");
    expect(flat).toContain("<b>hi</b>");
    for (const n of blocks[0].lines[0]) {
      expect(["text", "bold", "italic", "link"]).toContain(n.type);
    }
  });

  it("rejects javascript:/data:/vbscript: and relative link protocols", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("vbscript:msgbox")).toBeNull();
    expect(safeHref("/admin/secret")).toBeNull();
    expect(safeHref("ftp://host/x")).toBeNull();
  });

  it("allows only http/https/mailto links; unsafe link becomes literal text", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:info@bbettragency.com")).toBe("mailto:info@bbettragency.com");

    const nodes = parseInline("[click](javascript:alert(1))");
    // No link node produced; the whole token is preserved as readable text.
    expect(nodes.some((n) => n.type === "link")).toBe(false);
    expect(inlineText(nodes)).toBe("[click](javascript:alert(1))");
  });
});

describe("markdown parser — formatting", () => {
  it("parses **bold**", () => {
    const nodes = parseInline("Status: **Active (5)**");
    const bold = nodes.find((n) => n.type === "bold");
    expect(bold).toBeDefined();
    expect(inlineText(nodes)).toBe("Status: Active (5)");
  });

  it("parses *italic* and _italic_", () => {
    expect(parseInline("*one*").some((n) => n.type === "italic")).toBe(true);
    expect(parseInline("_two_").some((n) => n.type === "italic")).toBe(true);
  });

  it("parses a safe link with text", () => {
    const nodes = parseInline("see [the portal](https://portal.example.com)");
    const link = nodes.find((n) => n.type === "link");
    expect(link).toBeDefined();
    if (link?.type !== "link") throw new Error("expected link");
    expect(link.href).toBe("https://portal.example.com");
    expect(inlineText(link.children)).toBe("the portal");
  });

  it("groups '- ' and '* ' bullets into a single ul", () => {
    const blocks = parseMarkdown("Clients:\n- A&S\n- Imatec\n- DIAD");
    const ul = blocks.find((b) => b.type === "ul");
    expect(ul).toBeDefined();
    if (ul?.type !== "ul") throw new Error("expected ul");
    expect(ul.items).toHaveLength(3);
    expect(inlineText(ul.items[0])).toBe("A&S");
  });

  it("groups '1.' numbered items into a single ol", () => {
    const blocks = parseMarkdown("1. first\n2. second");
    const ol = blocks.find((b) => b.type === "ol");
    expect(ol?.type).toBe("ol");
    if (ol?.type !== "ol") throw new Error("expected ol");
    expect(ol.items).toHaveLength(2);
  });

  it("splits paragraphs on blank lines and keeps real line breaks within a paragraph", () => {
    const blocks = parseMarkdown("line one\nline two\n\nsecond para");
    const paras = blocks.filter((b) => b.type === "paragraph");
    expect(paras).toHaveLength(2);
    if (paras[0].type !== "paragraph") throw new Error("expected paragraph");
    // Two source lines ⇒ two rendered lines (a <br/> between them), NOT one run.
    expect(paras[0].lines).toHaveLength(2);
  });

  it("treats a literal backslash-n as ordinary text (no accidental break)", () => {
    // The UI fix is real newlines; a literal \n is NOT interpreted here — that stays
    // a deterministic-layer concern. We only assert the parser never crashes on it.
    const blocks = parseMarkdown("a\\nb");
    expect(blocks).toHaveLength(1);
  });

  it("does not loop or throw on stray markers", () => {
    expect(() => parseMarkdown("* unterminated and ** also")).not.toThrow();
    expect(inlineText(parseInline("a * b"))).toContain("*");
  });

  it("returns no blocks for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n  \n")).toEqual([]);
  });
});

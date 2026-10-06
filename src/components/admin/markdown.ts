/**
 * Minimal, SAFE Markdown → AST parser for Jarvis assistant messages.
 *
 * Pure (no React, no DOM) so it is unit-testable in the node test env; the renderer
 * builds React elements from this AST and NEVER uses dangerouslySetInnerHTML. Only a
 * small, safe subset is supported: paragraphs, hard line breaks, **bold**, *italic*,
 * `- `/`* ` bullet lists, `1.` ordered lists, and [text](url) links with a strict
 * protocol allowlist. Anything else (including any raw HTML like <script>) is treated
 * as PLAIN TEXT — it becomes a text node, so it can never execute or inject markup.
 */

export type MdInline =
  | { type: "text"; value: string }
  | { type: "bold"; children: MdInline[] }
  | { type: "italic"; children: MdInline[] }
  | { type: "link"; href: string; children: MdInline[] };

export type MdBlock =
  | { type: "paragraph"; lines: MdInline[][] }
  | { type: "ul"; items: MdInline[][] }
  | { type: "ol"; items: MdInline[][] };

/** Allow only safe link protocols; reject javascript:, data:, vbscript:, etc. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  return null;
}

function pushText(out: MdInline[], value: string): void {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.value += value;
  else out.push({ type: "text", value });
}

/** Index of the next inline-special char at or after `from`, or s.length. */
function nextSpecial(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "*" || c === "_" || c === "[") return i;
  }
  return s.length;
}

export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\*\*([\s\S]+?)\*\*/.exec(rest))) {
      out.push({ type: "bold", children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      const href = safeHref(m[2]);
      if (href) out.push({ type: "link", href, children: parseInline(m[1]) });
      else pushText(out, m[0]); // unsafe/relative URL ⇒ literal text, no anchor
      i += m[0].length;
      continue;
    }
    if ((m = /^[*_]([^*_\n]+?)[*_]/.exec(rest))) {
      out.push({ type: "italic", children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    // Plain run up to (but starting the search AFTER) the current char, so a stray
    // '*'/'_'/'[' that didn't form a token is consumed as text (no infinite loop).
    const next = nextSpecial(s, i + 1);
    pushText(out, s.slice(i, next));
    i = next;
  }
  return out;
}

const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+\.\s+(.*)$/;

export function parseMarkdown(text: string): MdBlock[] {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let para: MdInline[][] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", lines: para });
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }
    if (BULLET_RE.test(line)) {
      flushPara();
      const items: MdInline[][] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(parseInline(lines[i].replace(BULLET_RE, "$1")));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (ORDERED_RE.test(line)) {
      flushPara();
      const items: MdInline[][] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(parseInline(lines[i].replace(ORDERED_RE, "$1")));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    para.push(parseInline(line));
    i++;
  }
  flushPara();
  return blocks;
}

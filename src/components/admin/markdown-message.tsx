import type { JSX } from "react";
import { parseMarkdown, type MdBlock, type MdInline } from "./markdown";

/**
 * Safe Markdown renderer for Jarvis assistant messages.
 *
 * Renders the bounded subset parsed by `parseMarkdown` into React elements. It NEVER
 * uses dangerouslySetInnerHTML and never emits HTML from the model's text: every leaf
 * is a React text node, so bold/italic/list/link markup is the ONLY formatting that can
 * appear and any raw HTML in the message is shown literally. Links are restricted to the
 * http/https/mailto allowlist (see markdown.ts) and open with rel="noopener noreferrer".
 */

function renderInline(nodes: MdInline[], keyPrefix: string): JSX.Element[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.type) {
      case "text":
        return <span key={key}>{n.value}</span>;
      case "bold":
        return <strong key={key}>{renderInline(n.children, key)}</strong>;
      case "italic":
        return <em key={key}>{renderInline(n.children, key)}</em>;
      case "link":
        return (
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
            {renderInline(n.children, key)}
          </a>
        );
    }
  });
}

function renderBlock(block: MdBlock, key: string): JSX.Element {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} className="whitespace-pre-wrap">
          {block.lines.map((line, i) => (
            <span key={`${key}-l${i}`}>
              {i > 0 ? <br /> : null}
              {renderInline(line, `${key}-l${i}`)}
            </span>
          ))}
        </p>
      );
    case "ul":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={`${key}-i${i}`}>{renderInline(item, `${key}-i${i}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={`${key}-i${i}`}>{renderInline(item, `${key}-i${i}`)}</li>
          ))}
        </ol>
      );
  }
}

export function MarkdownMessage({ text, className }: { text: string; className?: string }): JSX.Element {
  const blocks = parseMarkdown(text);
  return <div className={className ? `${className} space-y-3` : "space-y-3"}>{blocks.map((b, i) => renderBlock(b, `b${i}`))}</div>;
}

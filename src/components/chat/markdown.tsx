"use client";

import { Fragment, memo } from "react";
import { cn } from "@/lib/utils";

/**
 * A tiny, streaming-safe Markdown renderer for Nova's chat.
 *
 * The model's answers arrive as plain text mid-stream and are re-parsed from
 * scratch on every frame, so this parses line-by-line with string scanning:
 * cheap, allocation-light, and re-runnable (why this instead of react-markdown
 * — the visitor's device shouldn't pull a parser dependency for a chat panel).
 *
 * Supports what a 2–4 sentence assistant answer actually uses: **bold**,
 * *italic*, `code`, [links](url), bullet lists, numbered lists, ### headings,
 * and bare URLs. Anything unparsable degrades to plain text — never to the
 * literal asterisks the user is complaining about.
 *
 * NOT supported on purpose: block quotes, images, HTML, tables. A grounded
 * portfolio assistant has no reason to emit them.
 */

// Matches Markdown links, **bold** (or __bold__), *italic*, `code`, and a bare
// URL, anywhere in a line. Links come first so their destination isn't parsed
// as a separate bare URL. Bold first so ** wins over *; italic is star-only
// (underscore italics misfire on snake_case_words).
const INLINE_RE =
  /(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*|__)(?=\S)([\s\S]*?\S)\4|(\*)(?=\S)([^*_\n]*?\S)\6|`([^`\n]+)`|((?:https?:\/\/|www\.)[^\s<>()\[\]{}"']+[^\s<>()\[\]{}"',.;:!?])/g;

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const BULLET_RE = /^\s*[-*+]\s+(.+)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.+)$/;

function normalizeUrl(url: string) {
  return url.startsWith("www.") ? `https://${url}` : url;
}

function isSafeHref(url: string) {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(url) && !url.startsWith("//");
}

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  let match: RegExpExecArray | null;
  let cursor = 0;
  let i = 0;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const [
      full,
      markdownLink,
      linkLabel,
      linkDestination,
      boldMarker,
      boldText,
      italicMarker,
      italicText,
      codeText,
      urlText,
    ] = match;
    if (markdownLink && linkLabel && linkDestination) {
      const href = normalizeUrl(linkDestination);
      nodes.push(
        isSafeHref(href) ? (
          <a
            key={`${keyPrefix}-a${i++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
          >
            {linkLabel}
          </a>
        ) : (
          <span key={`${keyPrefix}-t${i++}`}>{full}</span>
        ),
      );
    } else if (boldMarker) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold text-foreground">
          {boldText}
        </strong>,
      );
    } else if (italicMarker) {
      nodes.push(
        <em key={`${keyPrefix}-i${i++}`}>{italicText}</em>,
      );
    } else if (codeText !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i++}`}
          className="rounded-[0.3rem] bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {codeText}
        </code>,
      );
    } else if (urlText) {
      const href = normalizeUrl(urlText);
      nodes.push(
        <a
          key={`${keyPrefix}-a${i++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
        >
          {urlText}
        </a>,
      );
    }
    cursor = match.index + full.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** One line of text that is not part of a list — a heading or a paragraph. */
function InlineLine({
  text,
  keyPrefix,
}: {
  text: string;
  keyPrefix: string;
}) {
  const heading = HEADING_RE.exec(text);
  if (heading) {
    const level = heading[1].length;
    return (
      <span
        className={cn(
          "mt-1.5 block font-semibold text-foreground first:mt-0",
          level === 1 && "text-[15px]",
          level === 2 && "text-[14px]",
          level === 3 && "text-[13px] uppercase tracking-wide text-muted-foreground",
        )}
      >
        {renderInline(heading[2], keyPrefix)}
      </span>
    );
  }
  return <span className="block">{renderInline(text, keyPrefix)}</span>;
}

type ListItem = { text: string; ordered: boolean };

function ListView({ items, keyPrefix }: { items: ListItem[]; keyPrefix: string }) {
  const ordered = items[0]?.ordered ?? false;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "my-1 space-y-1 pl-4",
        ordered ? "list-decimal" : "list-disc",
        "marker:text-muted-foreground/70",
      )}
    >
      {items.map((item, index) => (
        <li key={`${keyPrefix}-li${index}`} className="leading-relaxed pl-0.5">
          {renderInline(item.text, `${keyPrefix}-li${index}`)}
        </li>
      ))}
    </Tag>
  );
}

function MarkdownImpl({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");

  const blocks: React.ReactNode[] = [];
  let list: ListItem[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      const paragraphLines = paragraph;
      blocks.push(
        <Fragment key={`p-${blocks.length}`}>
          {paragraphLines.map((line, i) => (
            <InlineLine key={`p-${blocks.length}-${i}`} text={line} keyPrefix={`p${blocks.length}-${i}`} />
          ))}
        </Fragment>,
      );
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length) {
      blocks.push(<ListView items={list} keyPrefix={`l-${blocks.length}`} />);
      list = [];
    }
  };

  for (const line of lines) {
    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);

    if (bullet || ordered) {
      flushParagraph();
      list.push({
        text: (bullet?.[1] ?? ordered![1]),
        ordered: Boolean(ordered),
      });
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className={cn("space-y-1.5", className)}>{blocks}</div>;
}

export const Markdown = memo(MarkdownImpl);

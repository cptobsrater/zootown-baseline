// Minimal safe Markdown -> React for ZooTown long-form articles.
// Handles # / ## / ### headings, paragraphs, - / * / 1. lists, > blockquotes,
// **bold**, *italic* / _italic_, `code`, and [label](url). No HTML passthrough.
import type { ReactNode } from "react";
import { Fragment, createElement } from "react";

function renderInline(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0, buf = "", k = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  while (i < line.length) {
    const ch = line[i];
    if (ch === "[") {
      const close = line.indexOf("](", i);
      const end = close > -1 ? line.indexOf(")", close + 2) : -1;
      if (close > -1 && end > -1) {
        flush();
        out.push(createElement("a", {
          key: `${keyBase}-l-${k++}`, href: line.slice(close + 2, end),
          target: "_blank", rel: "noopener noreferrer",
          className: "underline decoration-primary/40 underline-offset-2 hover:decoration-primary",
        }, line.slice(i + 1, close)));
        i = end + 1; continue;
      }
    }
    if (ch === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end > -1) {
        flush();
        out.push(createElement("strong", { key: `${keyBase}-b-${k++}`, className: "font-semibold text-foreground" }, ...renderInline(line.slice(i + 2, end), `${keyBase}-b${k}`)));
        i = end + 2; continue;
      }
    }
    if ((ch === "*" || ch === "_") && line[i + 1] !== ch) {
      const end = line.indexOf(ch, i + 1);
      if (end > -1 && end > i + 1) {
        flush();
        out.push(createElement("em", { key: `${keyBase}-i-${k++}` }, ...renderInline(line.slice(i + 1, end), `${keyBase}-i${k}`)));
        i = end + 1; continue;
      }
    }
    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      if (end > -1) {
        flush();
        out.push(createElement("code", { key: `${keyBase}-c-${k++}`, className: "rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.85em]" }, line.slice(i + 1, end)));
        i = end + 1; continue;
      }
    }
    buf += ch; i++;
  }
  flush();
  return out;
}

interface Block { type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote" | "hr"; lines: string[] }

function tokenize(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ type: "p", lines: [para.join(" ")] }); para = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); continue; }
    if (/^#\s+/.test(line)) { flushPara(); blocks.push({ type: "h1", lines: [line.replace(/^#\s+/, "")] }); continue; }
    if (/^##\s+/.test(line)) { flushPara(); blocks.push({ type: "h2", lines: [line.replace(/^##\s+/, "")] }); continue; }
    if (/^###\s+/.test(line)) { flushPara(); blocks.push({ type: "h3", lines: [line.replace(/^###\s+/, "")] }); continue; }
    if (/^>\s?/.test(line)) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      const stripped = line.replace(/^>\s?/, "");
      if (prev && prev.type === "quote") prev.lines.push(stripped);
      else blocks.push({ type: "quote", lines: [stripped] });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      const item = line.replace(/^[-*]\s+/, "");
      if (prev && prev.type === "ul") prev.lines.push(item);
      else blocks.push({ type: "ul", lines: [item] });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      const item = line.replace(/^\d+\.\s+/, "");
      if (prev && prev.type === "ol") prev.lines.push(item);
      else blocks.push({ type: "ol", lines: [item] });
      continue;
    }
    if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) { flushPara(); blocks.push({ type: "hr", lines: [] }); continue; }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

export function renderMarkdown(src: string): ReactNode {
  const blocks = tokenize(src);
  const children = blocks.map((b, idx) => {
    const key = `b${idx}`;
    if (b.type === "h1") return createElement("h2", { key, className: "font-serif text-2xl font-semibold text-foreground mt-2" }, ...renderInline(b.lines[0] ?? "", key));
    if (b.type === "h2") return createElement("h3", { key, className: "font-serif text-xl font-semibold text-foreground mt-6" }, ...renderInline(b.lines[0] ?? "", key));
    if (b.type === "h3") return createElement("h4", { key, className: "font-serif text-lg font-semibold text-foreground mt-5" }, ...renderInline(b.lines[0] ?? "", key));
    if (b.type === "ul") return createElement("ul", { key, className: "list-disc pl-5 space-y-1.5 text-[0.98rem] leading-relaxed text-foreground/90" }, ...b.lines.map((li, j) => createElement("li", { key: `${key}-${j}` }, ...renderInline(li, `${key}-${j}`))));
    if (b.type === "ol") return createElement("ol", { key, className: "list-decimal pl-5 space-y-1.5 text-[0.98rem] leading-relaxed text-foreground/90" }, ...b.lines.map((li, j) => createElement("li", { key: `${key}-${j}` }, ...renderInline(li, `${key}-${j}`))));
    if (b.type === "quote") return createElement("blockquote", { key, className: "border-l-2 border-primary pl-4 italic text-foreground/80 text-[0.98rem] leading-relaxed" }, ...b.lines.flatMap((l, j) => [...renderInline(l, `${key}-${j}`), createElement(Fragment, { key: `${key}-${j}-br` }, " ")]));
    if (b.type === "hr") return createElement("hr", { key, className: "border-border" });
    return createElement("p", { key, className: "text-[0.98rem] leading-relaxed text-foreground/90" }, ...renderInline(b.lines[0] ?? "", key));
  });
  return createElement("div", { className: "space-y-4" }, ...children);
}

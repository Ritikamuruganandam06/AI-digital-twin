import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * Renders AI-generated Markdown (AssistantPage answers, What-If Simulation
 * summaries, ExecutionDetailPage's final response) as real HTML instead of
 * showing raw `**bold**` / `| table |` / `---` syntax (Phase 17 "AI
 * Assistant Response UI / RAG Response Structuring Fix").
 *
 * This used to be a small, deliberately narrow hand-rolled parser
 * (headings/lists/bold/italic/code only, see git history) -- it never
 * understood GFM tables, fenced code blocks, checklists, links, or
 * horizontal rules, so any of those in a real answer (the Payment Service
 * Recovery Runbook's own Markdown, or Groq's own table/checklist-heavy
 * formatting of it) showed up as literal `|`/`---`/`` ``` `` characters.
 * That -- not the backend or the RAG pipeline, which already returns
 * ordinary Markdown text in `finalResponse` -- was the actual root cause.
 * Reliably hand-rolling full CommonMark+GFM parsing (escaped pipes,
 * multi-line table cells, nested lists, fenced code with backticks inside
 * backticks...) is exactly the kind of thing not worth re-implementing,
 * so this now composes three small, single-purpose, well-tested packages
 * instead of one large UI framework:
 *
 * - `react-markdown` renders Markdown straight to React elements. It
 *   never uses `dangerouslySetInnerHTML`, and by default any raw HTML the
 *   model's answer happens to contain is converted to inert literal text
 *   rather than parsed into real DOM nodes (no `rehype-raw` plugin is
 *   used here) -- so `<script>` in an answer can never execute. Every
 *   link/image URL is also passed through `defaultUrlTransform`, which
 *   strips any scheme other than http(s)/mailto/ircs/xmpp, so a
 *   `javascript:` link in a model answer can't run either. AI output is
 *   untrusted content and this renderer treats it that way by default,
 *   not through anything bespoke here.
 * - `remark-gfm` adds GitHub-flavored tables, checklists (`- [ ]`),
 *   strikethrough, and autolinks on top of CommonMark.
 * - `remark-breaks` makes a single line break inside a paragraph render
 *   as a real line break instead of CommonMark's default "join with a
 *   space" -- matching how these answers are actually written (short
 *   facts stacked one per line without a blank line between them) so
 *   they don't visually run together.
 */

/**
 * Demote headings so a model's own `#`/`##` never competes with the page's
 * real `<h1>` title -- same idea the old renderer used (which only ever
 * saw 1-3 `#`s and collapsed them to h3/h4), extended to the full h1-h6
 * range GFM/CommonMark allow. Three visual tiers rather than a strict
 * one-for-one shift: h1/h2 both read as "section" (h3), h3/h4 both read
 * as "subsection" (h4) -- this is the tier real answers actually use
 * (e.g. "## Payment Service Recovery" then "#### 1. Confirm current
 * state") -- and h5/h6 read as a small uppercase label (h5).
 */
const HEADING_TAG = { h1: 'h3', h2: 'h3', h3: 'h4', h4: 'h4', h5: 'h5', h6: 'h5' } as const;

function heading(level: keyof typeof HEADING_TAG) {
  const Tag = HEADING_TAG[level];
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag className="md-heading">{children}</Tag>;
  };
}

function mergeClassName(base: string, className?: string) {
  return className ? `${base} ${className}` : base;
}

const components: Components = {
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  h5: heading('h5'),
  h6: heading('h6'),
  ul: ({ children, className }) => <ul className={mergeClassName('md-list', className)}>{children}</ul>,
  ol: ({ children, className }) => <ol className={mergeClassName('md-list', className)}>{children}</ol>,
  li: ({ children, className }) => <li className={className}>{children}</li>,
  a: ({ children, href }) => (
    <a href={href} className="md-link" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  hr: () => <hr className="md-hr" />,
  table: ({ children }) => (
    <div className="table-wrap md-table-wrap">
      <table className="data-table md-table">{children}</table>
    </div>
  ),
  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
  pre: ({ children }) => <pre className="code-block md-code-block">{children}</pre>,
  code(props) {
    // react-markdown passes an extra `node` prop (the raw hast/mdast AST
    // node, `passNode: true`) to every component override -- explicitly
    // dropped here rather than spread, or it would render as a literal
    // `node="[object Object]"` DOM attribute.
    const { className, children, node: _node, ...rest } = props as ComponentPropsWithoutRef<'code'> & ExtraProps;
    // Fenced code blocks (```) get a `language-xxx` class from the
    // markdown parser; a bare `inline code` span never does. react-markdown
    // no longer passes a separate `inline` boolean (removed in v9), so this
    // className check is the documented way to tell them apart.
    const isFenced = typeof className === 'string' && className.startsWith('language-');
    return (
      <code className={isFenced ? mergeClassName('text-mono', className) : 'text-mono md-inline-code'} {...rest}>
        {children}
      </code>
    );
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md stack" style={{ gap: 'var(--space-3)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

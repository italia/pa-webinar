/**
 * Markdown editor + renderer for free-form event descriptions.
 *
 * Why markdown instead of a WYSIWYG (Tiptap/Lexical):
 *   - The description is content authored by a PA ops team, not a
 *     full CMS. Bold/italic/lists/links/headings/images-by-URL cover
 *     the use case with zero runtime JSON schema.
 *   - The DB column is a plain `Text` — no migration, and the same
 *     string travels into iCal/SEO descriptions where markdown is
 *     stripped server-side.
 *   - WYSIWYG editors ship ~200kb of JS; markdown+DOMPurify is ~40kb.
 *
 * Sanitizer: DOMPurify in the default "safe" profile. The renderer
 * strips `<script>`, inline event handlers, javascript: URLs and any
 * custom data-* attributes we don't use.
 */

'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'del', 'ins',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

// Per-tag allowlist: keep sensitive attrs (`href`, `src`) scoped to the
// tags that actually use them. DOMPurify's global `ALLOWED_ATTR` would
// permit e.g. `<img href=javascript:...>` or `<p src=...>`, which are
// not valid markdown output but could be injected via raw HTML in the
// source and exploited by future renderer quirks. We strip those via a
// post-sanitize hook.
const ALLOWED_ATTRS = ['href', 'title', 'alt', 'src', 'target', 'rel', 'class'];
const ATTR_BY_TAG: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel', 'class']),
  img: new Set(['src', 'alt', 'title', 'class']),
  figure: new Set(['class']),
  figcaption: new Set(['class']),
};

let hooksInstalled = false;
function ensureHooks() {
  if (hooksInstalled) return;
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName?.toLowerCase();
    const scoped = tag ? ATTR_BY_TAG[tag] : undefined;
    // Drop href/src on tags that shouldn't carry them (e.g. href on
    // <img>, src on <p>). Other attrs pass through the global allowlist.
    if ((data.attrName === 'href' || data.attrName === 'src') && (!scoped || !scoped.has(data.attrName))) {
      data.keepAttr = false;
    }
  });
  // All anchors in event descriptions go to user-supplied URLs, so
  // force them to open in a new tab with `rel=noopener noreferrer` to
  // prevent reverse-tabnabbing.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A') {
      const el = node as Element;
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hooksInstalled = true;
}

export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';
  ensureHooks();
  const raw = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
  });
}

interface MarkdownRendererProps {
  /** Raw markdown text. */
  content: string;
  className?: string;
}

/**
 * Read-only renderer. Safe to inject the returned HTML because the
 * sanitizer drops scripts and event handlers before it returns.
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div
      className={`markdown-body${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
  /** Label shown above the toolbar (localized). */
  label?: string;
  /** Help text under the editor. */
  hint?: string;
  invalid?: boolean;
  errorText?: string;
}

/**
 * Textarea + live preview. No toolbar — markdown is the contract, not
 * a mystery button-grid — but with a compact "preview/edit" toggle.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 8,
  id,
  label,
  hint,
  invalid,
  errorText,
}: MarkdownEditorProps) {
  const t = useTranslations('markdown');
  const [preview, setPreview] = useState(false);
  const html = useMemo(() => renderMarkdown(value), [value]);

  return (
    <div className="markdown-editor">
      <div className="d-flex align-items-center justify-content-between mb-1">
        {label && <label htmlFor={id} className="form-label mb-0">{label}</label>}
        <div className="btn-group btn-group-sm" role="tablist">
          <button
            type="button"
            className={`btn btn-sm ${preview ? 'btn-outline-secondary' : 'btn-secondary'}`}
            onClick={() => setPreview(false)}
          >
            {t('edit')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${preview ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={() => setPreview(true)}
            disabled={!value}
          >
            {t('preview')}
          </button>
        </div>
      </div>

      {!preview ? (
        <textarea
          id={id}
          className={`form-control${invalid ? ' is-invalid' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.9rem' }}
        />
      ) : (
        <div
          className="markdown-body border rounded p-3"
          style={{ minHeight: `${rows * 1.6}rem`, background: '#fff' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      <div className="d-flex justify-content-between mt-1">
        <small className="text-muted">{hint ?? t('hint')}</small>
        <small className="text-muted">{t('syntaxHelp')}</small>
      </div>
      {invalid && errorText && (
        <div className="invalid-feedback d-block">{errorText}</div>
      )}
    </div>
  );
}

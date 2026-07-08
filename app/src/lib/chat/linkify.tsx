import type { ReactNode } from 'react';

/**
 * Match http(s) URLs only. Deliberately conservative: never matches
 * `javascript:`/`data:` (requires an `https?://` scheme), stops at whitespace
 * and angle brackets. Anything else stays plain text.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>]+/gi;

/** Trailing chars that are almost always sentence punctuation, not part of the
 *  URL — trimmed off so "(https://a.com)." doesn't linkify the ")." too.
 *  A trailing ")" is given back when the URL has an unmatched "(" so
 *  balanced-paren URLs (e.g. Wikipedia .../Foo_(bar)) keep their closing paren. */
function trimTrailingPunctuation(url: string): { url: string; trailing: string } {
  const m = url.match(/[.,;:!?)\]}'"]+$/);
  if (!m) return { url, trailing: '' };
  let kept = url.slice(0, url.length - m[0].length);
  let trailing = m[0];
  while (
    trailing.startsWith(')') &&
    (kept.match(/\(/g)?.length ?? 0) > (kept.match(/\)/g)?.length ?? 0)
  ) {
    kept += ')';
    trailing = trailing.slice(1);
  }
  return { url: kept, trailing };
}

/**
 * Turn a plain chat string into React nodes with http(s) URLs rendered as safe
 * anchors (F17). Non-URL text is returned as plain strings, so React still
 * escapes it — there is no `dangerouslySetInnerHTML`, hence no XSS surface.
 * Anchors carry `rel="noopener noreferrer nofollow"` and open in a new tab;
 * on a public PA room this blocks tab-nabbing and SEO-abuse, and the scheme
 * allow-list blocks `javascript:`/`data:` payloads.
 */
export function linkifyChat(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (start > last) nodes.push(text.slice(last, start));
    const { url, trailing } = trimTrailingPunctuation(raw);
    // Defensive re-check of the scheme (the regex already enforces http/https).
    if (/^https?:\/\//i.test(url)) {
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="chat-panel__link"
        >
          {url}
        </a>,
      );
    } else {
      nodes.push(url);
    }
    if (trailing) nodes.push(trailing);
    last = start + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

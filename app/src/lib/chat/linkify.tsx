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

// A mention is "@" (at a word boundary) followed by a handle of letters/
// digits/._- (no spaces — multi-word names collapse to a single handle at
// autocomplete time). Kept deliberately simple; rendering only, no linking.
const MENTION_RE = /(^|[\s(])@(\p{L}[\p{L}\p{N}._-]*)/gu;

/** First name-token, lowercased — used to flag a mention of the current user. */
function firstToken(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

/**
 * Does this message mention `displayName`?
 *
 * Same rule the renderer uses to highlight the @handle, exported so the panel
 * can also NOTIFY. Being named in a busy chat was previously indistinguishable
 * from any other message once you had scrolled away: "quando viene taggato
 * qualcuno non viene avviata alcuna notifica, né di suono né visiva".
 */
export function mentionsUser(text: string, displayName?: string): boolean {
  const self = displayName ? firstToken(displayName) : '';
  if (!self || !text) return false;
  for (const m of text.matchAll(MENTION_RE)) {
    if ((m[2] ?? '').toLowerCase() === self) return true;
  }
  return false;
}

/**
 * Render a chat body with BOTH safe URL linking and @mention highlighting.
 * Mentions of the current user (matched on their first name token) get a
 * stronger "self" style. Still no dangerouslySetInnerHTML — every text run is
 * a plain string React escapes, so there is no XSS surface.
 */
export function renderChatBody(text: string, selfName?: string): ReactNode[] {
  const self = selfName ? firstToken(selfName) : '';
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const lead = m[1] ?? '';
    const handle = m[2] ?? '';
    const at = (m.index ?? 0) + lead.length; // position of the "@"
    if (at > last) out.push(...linkifyChat(text.slice(last, at)));
    const isSelf = self.length > 0 && handle.toLowerCase() === self;
    out.push(
      <span
        key={`m${key++}`}
        className={isSelf ? 'chat-mention chat-mention--self' : 'chat-mention'}
        style={{
          color: 'var(--app-primary, #06c)',
          fontWeight: 600,
          ...(isSelf
            ? { background: 'rgba(0,102,204,0.12)', borderRadius: 4, padding: '0 2px' }
            : {}),
        }}
      >
        @{handle}
      </span>,
    );
    last = at + 1 + handle.length;
  }
  if (last < text.length) out.push(...linkifyChat(text.slice(last)));
  return out;
}

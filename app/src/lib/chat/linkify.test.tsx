import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

import { linkifyChat, renderChatBody, mentionsUser } from './linkify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = (n: ReactNode): any => (n as any).props;
const anchors = (nodes: ReactNode[]) => nodes.filter((n) => isValidElement(n));
const elements = (nodes: ReactNode[]) => nodes.filter((n) => isValidElement(n));

describe('linkifyChat', () => {
  it('returns plain text unchanged when there is no URL', () => {
    expect(linkifyChat('ciao a tutti')).toEqual(['ciao a tutti']);
  });

  it('wraps an http(s) URL in a safe anchor and preserves surrounding text', () => {
    const nodes = linkifyChat('vedi https://example.com/x qui');
    const a = anchors(nodes);
    expect(a).toHaveLength(1);
    expect(props(a[0]).href).toBe('https://example.com/x');
    expect(props(a[0]).target).toBe('_blank');
    expect(props(a[0]).rel).toBe('noopener noreferrer nofollow');
    expect(nodes[0]).toBe('vedi ');
    expect(nodes[nodes.length - 1]).toBe(' qui');
  });

  it('trims trailing sentence punctuation out of the link', () => {
    const nodes = linkifyChat('(https://a.com).');
    expect(props(anchors(nodes)[0]).href).toBe('https://a.com');
    expect(nodes.some((n) => n === ').')).toBe(true);
  });

  it('keeps a closing paren that belongs to the URL (balanced-paren links)', () => {
    const nodes = linkifyChat('vedi https://en.wikipedia.org/wiki/Foo_(bar). fine');
    expect(props(anchors(nodes)[0]).href).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    // the sentence-ending '.' still stays out of the href
    expect(nodes.some((n) => typeof n === 'string' && n.startsWith('.'))).toBe(true);
  });

  it('linkifies multiple URLs', () => {
    expect(anchors(linkifyChat('http://a.com and https://b.com'))).toHaveLength(2);
  });

  it('does NOT linkify non-http schemes or scheme-less text (XSS/abuse guard)', () => {
    expect(anchors(linkifyChat('javascript:alert(1)'))).toHaveLength(0);
    expect(anchors(linkifyChat('data:text/html,<script>'))).toHaveLength(0);
    expect(anchors(linkifyChat('www.example.com'))).toHaveLength(0);
  });

  it('preserves query string and fragment in the href', () => {
    const nodes = linkifyChat('https://a.com/p?x=1&y=2#h');
    expect(props(anchors(nodes)[0]).href).toBe('https://a.com/p?x=1&y=2#h');
  });
});

describe('renderChatBody (mentions + links)', () => {
  it('leaves plain text without mentions untouched', () => {
    expect(renderChatBody('ciao a tutti')).toEqual(['ciao a tutti']);
  });

  it('wraps a @mention in a highlight span', () => {
    const nodes = renderChatBody('grazie @Mario per il punto');
    const spans = elements(nodes);
    expect(spans).toHaveLength(1);
    expect(props(spans[0]).className).toBe('chat-mention');
    expect(props(spans[0]).children).toEqual(['@', 'Mario']);
  });

  it('marks a mention of the current user as self', () => {
    const nodes = renderChatBody('@Anna guarda qui', 'Anna Bianchi');
    const span = elements(nodes)[0];
    expect(props(span).className).toBe('chat-mention chat-mention--self');
  });

  it('still linkifies URLs alongside mentions', () => {
    const nodes = renderChatBody('@Bob vedi https://x.com ok');
    const els = elements(nodes);
    // one mention span + one anchor
    expect(els.length).toBe(2);
    const hasAnchor = els.some((e) => props(e).href === 'https://x.com');
    expect(hasAnchor).toBe(true);
  });

  it('does not treat an email local-part as a mention', () => {
    // "@" not at a word boundary (preceded by a letter) is not a mention.
    const nodes = renderChatBody('scrivimi a mario@example.com');
    expect(elements(nodes).filter((e) => props(e).className?.startsWith('chat-mention'))).toHaveLength(0);
  });
});

describe('mentionsUser', () => {
  it('matches the first name token, case-insensitively', () => {
    expect(mentionsUser('ciao @Alex come va', 'Alex Rossi')).toBe(true);
    expect(mentionsUser('ciao @alex', 'Alex Rossi')).toBe(true);
    expect(mentionsUser('ciao @ALEX', 'Alex')).toBe(true);
  });

  it('does not match a different handle', () => {
    expect(mentionsUser('ciao @Daniele', 'Alex')).toBe(false);
  });

  it('does not match an email or a mid-word @', () => {
    expect(mentionsUser('scrivi a alex@example.it', 'Alex')).toBe(false);
  });

  it('matches after an opening bracket or at the start', () => {
    expect(mentionsUser('@Alex ci sei?', 'Alex')).toBe(true);
    expect(mentionsUser('(@Alex)', 'Alex')).toBe(true);
  });

  it('is false without a display name or without text', () => {
    expect(mentionsUser('@Alex', undefined)).toBe(false);
    expect(mentionsUser('', 'Alex')).toBe(false);
  });
});

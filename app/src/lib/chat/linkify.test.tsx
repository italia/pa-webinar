import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

import { linkifyChat } from './linkify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = (n: ReactNode): any => (n as any).props;
const anchors = (nodes: ReactNode[]) => nodes.filter((n) => isValidElement(n));

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

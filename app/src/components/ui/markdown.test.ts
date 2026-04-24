/**
 * @vitest-environment jsdom
 *
 * Sanitization tests for the markdown renderer. These cover the XSS
 * allowlist (per-tag `href`/`src`, event handlers stripped, dangerous
 * URI schemes blocked) and the link-hardening hook (all anchors get
 * `target="_blank"` + `rel="noopener noreferrer"` to block reverse
 * tabnabbing).
 *
 * NOTE: DOMPurify hooks are registered process-wide on first call.
 * Multiple tests running in the same process all share the hooks —
 * that's intentional in prod too, so we assert on the final output
 * rather than trying to isolate hook state.
 */

import { describe, it, expect } from 'vitest';

import { renderMarkdown } from './markdown';

describe('renderMarkdown — XSS sanitization', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('renders plain markdown', () => {
    const html = renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('strips inline <script> tags', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips onerror handler from <img>', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert');
  });

  it('strips svg onload', () => {
    const html = renderMarkdown('<svg onload="alert(1)"></svg>');
    expect(html).not.toContain('onload');
    // <svg> itself is not in the allowlist — stripped entirely.
    expect(html).not.toContain('<svg');
  });

  it('blocks javascript: URLs in links', () => {
    // eslint-disable-next-line no-script-url
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href=["']javascript:/i);
  });

  it('blocks data: URLs in links', () => {
    const html = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toMatch(/href=["']data:/i);
  });

  it('strips href on non-<a> tags', () => {
    // Per-tag allowlist: href only belongs on anchors. Even if an
    // exotic renderer put href on an <img>, the hook removes it.
    const html = renderMarkdown('<img src="x" href="javascript:alert(1)">');
    expect(html).not.toContain('href');
  });

  it('strips src on non-<img>/<figure> tags', () => {
    const html = renderMarkdown('<p src="http://evil.test/steal">body</p>');
    expect(html).not.toContain('src=');
  });

  it('forces target="_blank" rel="noopener noreferrer" on anchors', () => {
    const html = renderMarkdown('[link](https://example.test)');
    expect(html).toMatch(/target=["']_blank["']/);
    expect(html).toMatch(/rel=["']noopener noreferrer["']/);
  });

  it('strips iframe tags entirely', () => {
    const html = renderMarkdown('<iframe src="https://evil.test"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('strips style attributes (not in allowlist)', () => {
    const html = renderMarkdown('<p style="color:red">red</p>');
    expect(html).not.toContain('style=');
  });

  it('strips form tags and inputs', () => {
    const html = renderMarkdown('<form><input name="x"></form>');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });

  it('preserves safe image src', () => {
    const html = renderMarkdown('![alt](https://example.test/pic.png)');
    expect(html).toContain('<img');
    expect(html).toMatch(/src=["']https:\/\/example\.test\/pic\.png["']/);
  });

  it('preserves code blocks', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code>');
    expect(html).toContain('const x = 1;');
  });
});

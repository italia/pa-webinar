import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MESSAGES_DIR = path.resolve(__dirname, 'messages');

function getLocaleFiles(): string[] {
  return fs
    .readdirSync(MESSAGES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

function loadMessages(locale: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(MESSAGES_DIR, locale), 'utf-8');
  return JSON.parse(raw);
}

function getNestedKey(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe('Chat i18n keys present in all locales', () => {
  const localeFiles = getLocaleFiles();
  const requiredKeys = [
    'live.sidebarTabChat',
    'live.chat.placeholder',
    'live.chat.send',
    'live.chat.noMessages',
  ];

  it('has at least 2 locale files', () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of localeFiles) {
    const locale = file.replace('.json', '');

    describe(`locale: ${locale}`, () => {
      const messages = loadMessages(file);

      for (const key of requiredKeys) {
        it(`has key "${key}"`, () => {
          const value = getNestedKey(messages, key);
          expect(value, `Missing key "${key}" in ${file}`).toBeDefined();
          expect(typeof value, `Key "${key}" in ${file} should be a string`).toBe('string');
          expect((value as string).length, `Key "${key}" in ${file} should not be empty`).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe('Chat i18n keys consistency with reference (it.json)', () => {
  const localeFiles = getLocaleFiles();
  const itMessages = loadMessages('it.json');
  const enMessages = loadMessages('en.json');

  it('Italian has specific chat translations', () => {
    expect(getNestedKey(itMessages, 'live.sidebarTabChat')).toBe('Chat');
    expect(getNestedKey(itMessages, 'live.chat.placeholder')).toBe('Scrivi un messaggio...');
    expect(getNestedKey(itMessages, 'live.chat.send')).toBe('Invia');
    expect(getNestedKey(itMessages, 'live.chat.noMessages')).toBe('Nessun messaggio');
  });

  it('English has specific chat translations', () => {
    expect(getNestedKey(enMessages, 'live.sidebarTabChat')).toBe('Chat');
    expect(getNestedKey(enMessages, 'live.chat.placeholder')).toBe('Type a message...');
    expect(getNestedKey(enMessages, 'live.chat.send')).toBe('Send');
    expect(getNestedKey(enMessages, 'live.chat.noMessages')).toBe('No messages yet');
  });

  it('sidebarTabChat appears between sidebarTabQa and sidebarTabPolls in all locales', () => {
    for (const file of localeFiles) {
      const raw = fs.readFileSync(path.join(MESSAGES_DIR, file), 'utf-8');
      const qaIdx = raw.indexOf('"sidebarTabQa"');
      const chatIdx = raw.indexOf('"sidebarTabChat"');
      const pollsIdx = raw.indexOf('"sidebarTabPolls"');

      expect(qaIdx, `sidebarTabQa missing in ${file}`).toBeGreaterThan(-1);
      expect(chatIdx, `sidebarTabChat missing in ${file}`).toBeGreaterThan(-1);
      expect(pollsIdx, `sidebarTabPolls missing in ${file}`).toBeGreaterThan(-1);
      expect(chatIdx, `sidebarTabChat should come after sidebarTabQa in ${file}`).toBeGreaterThan(qaIdx);
      expect(chatIdx, `sidebarTabChat should come before sidebarTabPolls in ${file}`).toBeLessThan(pollsIdx);
    }
  });
});

describe('All locale files are valid JSON', () => {
  const localeFiles = getLocaleFiles();

  for (const file of localeFiles) {
    it(`${file} is valid JSON`, () => {
      const raw = fs.readFileSync(path.join(MESSAGES_DIR, file), 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  }
});

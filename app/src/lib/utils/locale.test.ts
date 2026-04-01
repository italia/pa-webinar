import { describe, it, expect } from 'vitest';
import type { Event } from '@prisma/client';
import { resolveLocale, localiseEvent } from './locale';

function makeRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

// Minimal mock Event for localiseEvent
function mockEvent(overrides?: Partial<Event>): Event {
  return {
    id: 'test-id',
    slug: 'test-event',
    titleIt: 'Titolo Italiano',
    titleEn: 'English Title',
    descriptionIt: 'Descrizione italiana',
    descriptionEn: 'English description',
    startsAt: new Date(),
    endsAt: new Date(),
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    qaEnabled: true,
    chatEnabled: false,
    recordingEnabled: false,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    requireOrganization: false,
    requireOrganizationRole: false,
    requireOrganizationType: false,
    dataRetentionDays: 30,
    privacyPolicyUrl: null,
    privacyPolicyText: null,
    moderatorName: null,
    moderatorEmail: null,
    moderatorToken: 'mod-token',
    jitsiRoomName: 'room-1',
    speakersIt: null,
    speakersEn: null,
    organizerName: null,
    imageUrl: null,
    waitingRoomAudioUrl: null,
    recordingUrl: null,
    status: 'PUBLISHED',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Event;
}

// ── resolveLocale ───────────────────────────────────────────

describe('resolveLocale', () => {
  it('returns locale from ?locale=en query param', () => {
    const result = resolveLocale(makeRequest('http://localhost?locale=en'));
    expect(result).toBe('en');
  });

  it('returns locale from ?locale=it query param', () => {
    const result = resolveLocale(makeRequest('http://localhost?locale=it'));
    expect(result).toBe('it');
  });

  it('returns en from Accept-Language: en-US', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'en-US,en;q=0.9' }),
    );
    expect(result).toBe('en');
  });

  it('returns it from Accept-Language: it-IT', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'it-IT,it;q=0.9' }),
    );
    expect(result).toBe('it');
  });

  it('defaults to it when no hints', () => {
    const result = resolveLocale(makeRequest('http://localhost'));
    expect(result).toBe('it');
  });

  it('ignores unsupported locales in Accept-Language', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'fr-FR,de;q=0.5' }),
    );
    expect(result).toBe('it'); // default
  });

  it('query param takes priority over Accept-Language', () => {
    const result = resolveLocale(
      makeRequest('http://localhost?locale=en', { 'accept-language': 'it-IT' }),
    );
    expect(result).toBe('en');
  });
});

// ── localiseEvent ───────────────────────────────────────────

describe('localiseEvent', () => {
  it('returns Italian title/description for it locale', () => {
    const event = mockEvent();
    const { title, description } = localiseEvent(event, 'it');
    expect(title).toBe('Titolo Italiano');
    expect(description).toBe('Descrizione italiana');
  });

  it('returns English title/description for en locale', () => {
    const event = mockEvent();
    const { title, description } = localiseEvent(event, 'en');
    expect(title).toBe('English Title');
    expect(description).toBe('English description');
  });

  it('falls back to Italian when English fields are null', () => {
    const event = mockEvent({ titleEn: null, descriptionEn: null });
    const { title, description } = localiseEvent(event, 'en');
    expect(title).toBe('Titolo Italiano');
    expect(description).toBe('Descrizione italiana');
  });

  it('returns Italian fields even when English is available for it locale', () => {
    const event = mockEvent();
    const { title } = localiseEvent(event, 'it');
    expect(title).toBe('Titolo Italiano');
  });
});

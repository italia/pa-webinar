// @vitest-environment node
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Allegati e invito di calendario nella coda: l'invito (indirizzo e link
 * personale) sta cifrato a riposo; le righe di prima, in chiaro, si leggono
 * come sempre; una forma che non si riconosce non blocca l'invio.
 */
vi.mock('@/lib/db', () => ({ prisma: { emailOutbox: { create: vi.fn() } } }));

import { prisma } from '@/lib/db';

import {
  enqueueEmail,
  packOutboxParts,
  stripCalendarInvite,
  unpackOutboxParts,
} from './outbox';

const KEY = 'a'.repeat(64);
const previousKey = process.env.PII_ENCRYPTION_KEY;
beforeEach(() => {
  process.env.PII_ENCRYPTION_KEY = KEY;
  vi.clearAllMocks();
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = previousKey;
});

const INVITO = {
  method: 'REQUEST' as const,
  content:
    'BEGIN:VCALENDAR\r\nATTENDEE:mailto:persona@example.org\r\nURL:https://x/live?token=segreto\r\nEND:VCALENDAR\r\n',
};
const ALLEGATO = { filename: 'a.txt', content: 'ciao', contentType: 'text/plain' };

describe('packOutboxParts / unpackOutboxParts', () => {
  it('con l’invito la colonna è cifrata e si rilegge uguale', () => {
    const stored = packOutboxParts({ attachments: [ALLEGATO], calendarInvite: INVITO });
    const testo = JSON.stringify(stored);
    expect(testo).not.toContain('persona@example.org');
    expect(testo).not.toContain('segreto');
    expect(Array.isArray(stored)).toBe(false);
    expect(unpackOutboxParts(stored)).toEqual({
      attachments: [ALLEGATO],
      calendarInvite: INVITO,
    });
  });

  it('solo allegati: l’elenco in chiaro di sempre', () => {
    const stored = packOutboxParts({ attachments: [ALLEGATO] });
    expect(stored).toEqual([ALLEGATO]);
    expect(unpackOutboxParts(stored)).toEqual({ attachments: [ALLEGATO] });
  });

  it('niente da allegare: null', () => {
    expect(packOutboxParts({})).toBe(Prisma.JsonNull);
    expect(packOutboxParts({ attachments: [] })).toBe(Prisma.JsonNull);
    expect(unpackOutboxParts(null)).toEqual({});
  });

  it('le righe accodate prima si leggono ancora', () => {
    const legacy = [
      { filename: 'event.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' },
    ];
    expect(unpackOutboxParts(legacy)).toEqual({ attachments: legacy });
  });

  it('una forma che non si riconosce non blocca l’invio', () => {
    expect(unpackOutboxParts({ enc: 'non-è-cifrato' })).toEqual({});
    expect(unpackOutboxParts('testo')).toEqual({});
    expect(unpackOutboxParts([{ filename: 1 }])).toEqual({});
    const stored = packOutboxParts({
      calendarInvite: { method: 'CANCEL' as 'REQUEST', content: 'x' },
    });
    expect(unpackOutboxParts(stored)).toEqual({});
  });
});

describe('stripCalendarInvite', () => {
  it('toglie l’invito e tiene gli altri allegati; null se non c’era', () => {
    const conInvito = packOutboxParts({
      attachments: [ALLEGATO],
      calendarInvite: INVITO,
    });
    expect(stripCalendarInvite(conInvito)).toEqual([ALLEGATO]);
    expect(stripCalendarInvite(packOutboxParts({ calendarInvite: INVITO }))).toBe(
      Prisma.JsonNull
    );
    expect(stripCalendarInvite([ALLEGATO])).toBeNull();
    expect(stripCalendarInvite(null)).toBeNull();
  });

  it('una colonna cifrata illeggibile non si tocca, con un avviso senza dati', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(stripCalendarInvite({ enc: 'rovinato' })).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      '[email] outbox attachments unreadable, sending without them'
    );
    spy.mockRestore();
  });
});

describe('enqueueEmail', () => {
  it('salva l’invito cifrato nella colonna degli allegati', async () => {
    const create = prisma.emailOutbox.create as unknown as ReturnType<typeof vi.fn>;
    create.mockResolvedValue({ id: 'r1' });
    await enqueueEmail({
      to: 'persona@example.org',
      subject: 'S',
      html: '<p>h</p>',
      calendarInvite: INVITO,
    });
    const data = create.mock.calls[0]![0].data as { attachments: unknown };
    expect(JSON.stringify(data.attachments)).not.toContain('segreto');
    expect(unpackOutboxParts(data.attachments).calendarInvite).toEqual(INVITO);
  });
});

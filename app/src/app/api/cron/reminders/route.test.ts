import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il cron dei promemoria dal lato di chi riceve: quante email partono, con
 * quale anticipo, e cosa resta segnato come fatto.
 *
 * Il difetto era la raffica: un evento creato a poche ore dall'inizio, o
 * un'iscrizione tardiva, facevano partire nello stesso minuto tutti i
 * promemoria gia' scattati («inizia domani» a 18 minuti dall'inizio).
 * DB ed effetti collaterali sono stub; la scelta (reminder-plan) gira davvero.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    eventReminder: { findMany: vi.fn() },
    registration: { findMany: vi.fn() },
    reminderSent: { create: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: vi.fn() }));
vi.mock('@/lib/crypto/pii', () => ({ decryptPII: (v: string) => v }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({
    defaultLocale: 'it',
    siteName: 'Portale',
    publicRegistrationEnabled: true,
  }),
}));
vi.mock('@/lib/email/resolve-template', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadEmailTemplateOverride: vi.fn(async () => null),
}));
vi.mock('@/lib/events/post-event-finalize', () => ({
  finalizePostEventEmails: vi.fn(async () => ({
    eventsFinalized: 0,
    emailsSent: 0,
    emailsFailed: 0,
  })),
}));

import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';

import { GET } from './route';

const db = prisma as unknown as {
  eventReminder: { findMany: ReturnType<typeof vi.fn> };
  registration: { findMany: ReturnType<typeof vi.fn> };
  reminderSent: { create: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
};
const mockedEnqueue = enqueueEmail as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date('2026-09-25T21:30:00Z');
const START = new Date('2026-09-25T21:48:00Z'); // tra 18 minuti

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    slug: 'evento-serale',
    title: { it: 'Evento serale' },
    description: { it: 'Descrizione' },
    startsAt: START,
    endsAt: new Date(START.getTime() + 3_600_000),
    timezone: 'Europe/Rome',
    moderatorName: 'Segreteria',
    moderatorEmail: null,
    imageUrl: null,
    coverImageUrl: null,
    status: 'PUBLISHED',
    // Creato 40 minuti prima dell'inizio: meno di un giorno di anticipo.
    createdAt: new Date(START.getTime() - 40 * 60_000),
    updatedAt: new Date(START.getTime() - 40 * 60_000),
    ...over,
  };
}

function remindersFor(event: ReturnType<typeof eventRow>, offsets: number[]) {
  return offsets.map((offsetMinutes) => ({
    id: `rem-${offsetMinutes}`,
    eventId: event.id,
    offsetMinutes,
    label: `${offsetMinutes}`,
    // I promemoria nascono con l'evento.
    createdAt: event.createdAt,
    event,
  }));
}

function registration(id: string, createdAt: Date) {
  return {
    id,
    eventId: 'evt-1',
    email: `${id}@example.test`,
    locale: 'it',
    accessToken: `tok-${id}`,
    createdAt,
    person: null,
  };
}

/**
 * Lo stub del DB applica i filtri della query come farebbe Postgres: iscritti
 * dell'evento creati entro `createdAt.lte`, senza riga ReminderSent per quel
 * promemoria. Cosi' il test verifica la query, non solo il suo esito.
 */
function stubRegistrations(
  rows: ReturnType<typeof registration>[],
  alreadySent: Record<string, string[]> = {},
) {
  db.registration.findMany.mockImplementation(
    async ({ where }: { where: { createdAt: { lte: Date }; remindersSent: { none: { reminderId: string } } } }) =>
      rows.filter(
        (r) =>
          r.createdAt <= where.createdAt.lte &&
          !(alreadySent[r.id] ?? []).includes(where.remindersSent.none.reminderId),
      ),
  );
}

function cronRequest(): Request {
  return new Request('https://portale.example.test/api/cron/reminders', {
    headers: { 'x-api-key': 'cron-test-key' },
  });
}

const ctx = { params: Promise.resolve({}) };
const previousKey = process.env.CRON_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.CRON_API_KEY = 'cron-test-key';
  db.reminderSent.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  }));
  db.reminderSent.create.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  if (previousKey === undefined) delete process.env.CRON_API_KEY;
  else process.env.CRON_API_KEY = previousKey;
});

/** I soggetti delle email accodate per un destinatario. */
function subjectsTo(address: string): string[] {
  return mockedEnqueue.mock.calls
    .map((c) => c[0] as { to: string; subject: string })
    .filter((m) => m.to === address)
    .map((m) => m.subject);
}

describe('GET /api/cron/reminders — at most one reminder per registrant and run', () => {
  it('event created less than 24 h ahead: one reminder, the closest, never "tomorrow"', async () => {
    const event = eventRow();
    db.eventReminder.findMany.mockResolvedValue(remindersFor(event, [1440, 60, 30]));
    // Iscritta subito dopo la pubblicazione, 39 minuti prima dell'inizio.
    stubRegistrations([registration('anna', new Date(START.getTime() - 39 * 60_000))]);

    const res = await GET(cronRequest() as never, ctx as never);
    expect(res.status).toBe(200);

    const subjects = subjectsTo('anna@example.test');
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toContain('30 minuti');
    expect(subjects.join(' ')).not.toContain('domani');
    // Solo il promemoria spedito lascia una riga: il pannello dell'evento la
    // conta come «inviato», e il 1440 e il 60 non sono partiti.
    expect(db.reminderSent.create).toHaveBeenCalledTimes(1);
    expect(db.reminderSent.create).toHaveBeenCalledWith({
      data: { reminderId: 'rem-30', registrationId: 'anna' },
    });
    expect(db.reminderSent.createMany).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ emailsSent: 1, remindersProcessed: 1 });
  });

  it('event created less than 24 h ahead: nothing before the smallest reminder fires', async () => {
    vi.setSystemTime(new Date(START.getTime() - 35 * 60_000)); // T-35: 1440 e 60 scaduti alla nascita
    const event = eventRow();
    db.eventReminder.findMany.mockResolvedValue(remindersFor(event, [1440, 60, 30]));
    stubRegistrations([registration('anna', new Date(START.getTime() - 39 * 60_000))]);

    await GET(cronRequest() as never, ctx as never);
    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(db.registration.findMany).not.toHaveBeenCalled();
  });

  it('late registration: no burst, and nothing that fired before the sign-up', async () => {
    const event = eventRow({ createdAt: new Date('2026-09-20T10:00:00Z') });
    db.eventReminder.findMany.mockResolvedValue(remindersFor(event, [1440, 60, 30]));
    stubRegistrations(
      [
        // Iscritto da giorni: 1440 e 60 gia' ricevuti, ora tocca al 30.
        registration('bruno', new Date('2026-09-21T09:00:00Z')),
        // Iscritta 31 minuti prima dell'inizio: prima riceveva tre email.
        registration('carla', new Date(START.getTime() - 31 * 60_000)),
        // Iscritto 20 minuti prima: anche il 30 era scattato prima di lui.
        registration('dario', new Date(START.getTime() - 20 * 60_000)),
      ],
      { bruno: ['rem-1440', 'rem-60'] },
    );

    await GET(cronRequest() as never, ctx as never);

    expect(subjectsTo('bruno@example.test')).toHaveLength(1);
    const carla = subjectsTo('carla@example.test');
    expect(carla).toHaveLength(1);
    expect(carla[0]).toContain('30 minuti');
    expect(subjectsTo('dario@example.test')).toHaveLength(0);
    expect(mockedEnqueue).toHaveBeenCalledTimes(2);

    // Il .ics allegato e' una pubblicazione con UID stabile, non un invito.
    const mail = mockedEnqueue.mock.calls[0]![0] as {
      attachments: { content: string; contentType: string }[];
    };
    expect(mail.attachments[0]!.contentType).toContain('method=PUBLISH');
    expect(mail.attachments[0]!.content).toMatch(/^UID:evt-1@/m);
  });

  it('keeps sending the normal on-time reminder to early registrants', async () => {
    const event = eventRow({
      startsAt: new Date(NOW.getTime() + 59 * 60_000),
      createdAt: new Date('2026-09-01T10:00:00Z'),
    });
    db.eventReminder.findMany.mockResolvedValue(remindersFor(event, [1440, 60]));
    stubRegistrations([registration('elena', new Date('2026-09-02T10:00:00Z'))], {
      elena: ['rem-1440'],
    });

    await GET(cronRequest() as never, ctx as never);

    const subjects = subjectsTo('elena@example.test');
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toContain('1 ora');
  });
});

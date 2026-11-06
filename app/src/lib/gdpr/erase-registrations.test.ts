// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il blocco dell'evento viene prima di ogni cancellazione, e le prove si copiano
 * prima che la cascata le porti via.
 */
const m = vi.hoisted(() => ({
  tx: {
    eventFeedback: { deleteMany: vi.fn() },
    questionnaireResponse: { deleteMany: vi.fn() },
    chatMessage: { deleteMany: vi.fn() },
    wordCloudSubmission: { deleteMany: vi.fn() },
    chatMessageReaction: { deleteMany: vi.fn() },
    captionSegment: { deleteMany: vi.fn() },
    roomOccupant: { deleteMany: vi.fn() },
    registration: { deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
  transazione: vi.fn(),
  conservaProve: vi.fn(),
  tipiDelleProveEsistenti: vi.fn(),
  togliNomeDelleIscrizioni: vi.fn(),
  blocca: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    chatMessage: { findMany: vi.fn(async () => []) },
    $transaction: m.transazione,
  },
}));
vi.mock('@/lib/azure/blob-storage', () => ({
  isAzureConfigured: () => false,
  deleteBlob: vi.fn(),
}));
vi.mock('@/lib/captions/transcript', () => ({
  bloccaTrascrizioneEvento: m.blocca,
  togliPersoneDalleTrascrizioni: vi.fn(),
}));
vi.mock('@/lib/gdpr/retained-consent-proofs', () => ({
  conservaProve: m.conservaProve,
  tipiDelleProveEsistenti: m.tipiDelleProveEsistenti,
  togliNomeDelleIscrizioni: m.togliNomeDelleIscrizioni,
}));

import { TIMEOUT_PULIZIA_EVENTO_MS } from './cleanup-selection';
import { eraseRegistrations } from './erase-registrations';

const { tx } = m;
const ISCRIZIONI = [
  { id: 'r1', eventId: 'e2' },
  { id: 'r2', eventId: 'e1' },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const d of [
    tx.eventFeedback,
    tx.questionnaireResponse,
    tx.chatMessage,
    tx.wordCloudSubmission,
    tx.registration,
  ]) {
    d.deleteMany.mockResolvedValue({ count: 1 });
  }
  tx.$executeRaw.mockResolvedValue(0);
  m.transazione.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  m.tipiDelleProveEsistenti.mockResolvedValue(['recording', 'transcription']);
  m.conservaProve.mockResolvedValue(2);
  m.togliNomeDelleIscrizioni.mockResolvedValue(0);
});

describe('eraseRegistrations', () => {
  it('copia le prove senza nome, per ogni evento, prima di cancellare', async () => {
    const conti = await eraseRegistrations(ISCRIZIONI, 'prova');
    expect(m.conservaProve.mock.calls.map((c) => c[1].eventId)).toEqual(['e1', 'e2']);
    expect(m.conservaProve).toHaveBeenCalledWith(tx, {
      eventId: 'e1',
      tipi: ['recording', 'transcription'],
      registrationIds: ['r1', 'r2'],
      senzaNome: true,
      adesso: expect.any(Date),
    });
    expect(m.conservaProve.mock.invocationCallOrder[1]).toBeLessThan(
      tx.registration.deleteMany.mock.invocationCallOrder[0]!
    );
    expect(conti.consentProofsKept).toBe(4);
  });

  it('niente di pubblicato: nessuna prova conservata', async () => {
    m.conservaProve.mockResolvedValue(0);
    expect(
      (await eraseRegistrations(ISCRIZIONI.slice(0, 1), 'prova')).consentProofsKept
    ).toBe(0);
  });

  it('la transazione ha un timeout esplicito', async () => {
    await eraseRegistrations(ISCRIZIONI, 'prova');
    expect(m.transazione.mock.calls[0]![1].timeout).toBeGreaterThan(5_000);
  });

  it('puo\' aspettare tutta la pulizia dello stesso evento', async () => {
    await eraseRegistrations(ISCRIZIONI, 'prova');
    expect(m.transazione.mock.calls[0]![1].timeout).toBeGreaterThan(TIMEOUT_PULIZIA_EVENTO_MS);
  });

  it('blocca gli eventi in ordine prima di ogni cancellazione', async () => {
    await eraseRegistrations(ISCRIZIONI, 'prova');
    expect(m.blocca.mock.calls.map((c) => c[1])).toEqual(['e1', 'e2']);
    const ultimoBlocco = m.blocca.mock.invocationCallOrder[1]!;
    for (const d of [
      tx.eventFeedback,
      tx.questionnaireResponse,
      tx.chatMessage,
      tx.wordCloudSubmission,
      tx.chatMessageReaction,
      tx.captionSegment,
      tx.roomOccupant,
      tx.registration,
    ]) {
      expect(ultimoBlocco).toBeLessThan(d.deleteMany.mock.invocationCallOrder[0]!);
    }
  });

  it('toglie il nome da cio’ che una pulizia ha gia’ copiato, per evento e iscrizione', async () => {
    m.conservaProve.mockResolvedValue(0);
    m.togliNomeDelleIscrizioni.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const conti = await eraseRegistrations(ISCRIZIONI, 'prova');

    expect(m.togliNomeDelleIscrizioni.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['e1', ['r2']],
      ['e2', ['r1']],
    ]);
    expect(m.togliNomeDelleIscrizioni.mock.calls[0]![0]).toBe(tx);
    expect(m.blocca.mock.invocationCallOrder[1]).toBeLessThan(
      m.togliNomeDelleIscrizioni.mock.invocationCallOrder[0]!
    );
    expect(conti.consentProofsKept).toBe(3);
  });
});

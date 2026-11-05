// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Le interrogazioni libere a Prometheus: sono aperte solo a chi amministra
 * l'istanza, si tiene traccia di quelle riuscite, e un guasto di Prometheus non
 * diventa un 500 del portale.
 */
import { SignJWT } from 'jose';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, prometheus, barattolo } = vi.hoisted(() => ({
  prisma: {
    adminAuditLog: { create: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
  },
  prometheus: {
    isPrometheusConfigured: vi.fn(),
    queryPrometheus: vi.fn(),
    queryPrometheusRange: vi.fn(),
  },
  barattolo: { sessione: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/prometheus', () => prometheus);
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && barattolo.sessione
        ? { value: barattolo.sessione }
        : undefined,
  }),
}));

import { POST } from './route';

const SEGRETO = 'segreto-di-prova-della-sessione-abbastanza-lungo';
const ACCOUNT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PROMQL = 'up{job="portale"}';
const RISULTATO = { status: 'success', data: { resultType: 'vector', result: [] } };
const INTERVALLO = {
  start: '2026-11-04T10:00:00Z',
  end: '2026-11-04T11:00:00Z',
  step: '60s',
};

function firma(
  claims: Record<string, unknown>,
  opzioni: { segreto?: string; soggetto?: string } = {}
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h');
  if (opzioni.soggetto) jwt.setSubject(opzioni.soggetto);
  return jwt.sign(new TextEncoder().encode(opzioni.segreto ?? SEGRETO));
}

function interroga(corpo: unknown) {
  const request = new Request('http://localhost:3000/api/admin/metrics/query', {
    method: 'POST',
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function nienteInterrogato() {
  expect(prometheus.queryPrometheus).not.toHaveBeenCalled();
  expect(prometheus.queryPrometheusRange).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  barattolo.sessione = await firma({ role: 'admin' });
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'riga-1' });
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT_ID,
    active: true,
    role: 'ADMIN',
    emailHash: 'impronta',
    name: 'nome-cifrato',
  });
  prometheus.isPrometheusConfigured.mockReturnValue(true);
  prometheus.queryPrometheus.mockResolvedValue(RISULTATO);
  prometheus.queryPrometheusRange.mockResolvedValue(RISULTATO);
});

describe('chi puo’ interrogare', () => {
  it('senza sessione e’ 401, e non dice nemmeno se Prometheus c’e’', async () => {
    barattolo.sessione = undefined;
    expect((await interroga({ query: PROMQL })).status).toBe(401);
    prometheus.isPrometheusConfigured.mockReturnValue(false);
    expect((await interroga({ query: PROMQL })).status).toBe(401);
    nienteInterrogato();
  });

  it('un token firmato altrove e’ 401', async () => {
    barattolo.sessione = await firma(
      { role: 'admin' },
      { segreto: 'un-altro-segreto-lungo-quanto-basta-per-firmare' }
    );
    expect((await interroga({ query: PROMQL })).status).toBe(401);
    nienteInterrogato();
  });

  it('l’organizzatore non interroga, anche se il token dice ancora admin', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      active: true,
      role: 'ORGANIZER',
      emailHash: 'impronta',
      name: 'nome-cifrato',
    });
    barattolo.sessione = await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID });
    expect((await interroga({ query: PROMQL })).status).toBe(401);
    nienteInterrogato();
  });

  it('un amministratore disattivato perde l’accesso subito', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      active: false,
      role: 'ADMIN',
      emailHash: 'impronta',
      name: 'nome-cifrato',
    });
    barattolo.sessione = await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID });
    expect((await interroga({ query: PROMQL })).status).toBe(401);
    nienteInterrogato();
  });

  it('un account amministratore attivo interroga', async () => {
    barattolo.sessione = await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID });
    expect((await interroga({ query: PROMQL })).status).toBe(200);
  });
});

describe('la domanda', () => {
  it('senza Prometheus configurato lo dice, senza interrogare e senza traccia', async () => {
    prometheus.isPrometheusConfigured.mockReturnValue(false);
    const r = await interroga({ query: PROMQL });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ available: false });
    nienteInterrogato();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await interroga('non json')).status).toBe(400);
    nienteInterrogato();
  });

  it('senza interrogazione, o con una fuori misura, e’ 422', async () => {
    for (const corpo of [
      {},
      { query: '' },
      { query: 42 },
      { query: 'x'.repeat(4097) },
      { query: PROMQL, start: '' },
      { query: PROMQL, start: 'x'.repeat(65) },
      { query: PROMQL, end: 'x'.repeat(65) },
      { query: PROMQL, step: 'x'.repeat(33) },
    ]) {
      expect((await interroga(corpo)).status).toBe(422);
    }
    nienteInterrogato();
  });
});

describe('la risposta', () => {
  it('un’interrogazione istantanea arriva intatta e lascia traccia', async () => {
    const r = await interroga({ query: PROMQL });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ available: true, ...RISULTATO });
    expect(prometheus.queryPrometheus).toHaveBeenCalledWith(PROMQL);
    expect(prometheus.queryPrometheusRange).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'ADMIN_METRICS_QUERY',
      target: PROMQL,
      details: null,
    });
  });

  it('con inizio, fine e passo si interroga l’intervallo', async () => {
    await interroga({ query: PROMQL, ...INTERVALLO });
    expect(prometheus.queryPrometheusRange).toHaveBeenCalledWith(
      PROMQL,
      INTERVALLO.start,
      INTERVALLO.end,
      INTERVALLO.step
    );
    expect(prometheus.queryPrometheus).not.toHaveBeenCalled();
    const { details } = prisma.adminAuditLog.create.mock.calls[0]![0].data as {
      details: string;
    };
    expect(JSON.parse(details)).toEqual(INTERVALLO);
  });

  it('un intervallo incompleto resta istantaneo', async () => {
    await interroga({ query: PROMQL, start: INTERVALLO.start, step: INTERVALLO.step });
    expect(prometheus.queryPrometheus).toHaveBeenCalledWith(PROMQL);
    expect(prometheus.queryPrometheusRange).not.toHaveBeenCalled();
  });

  it('un guasto di Prometheus e’ 502, non un errore del portale', async () => {
    prometheus.queryPrometheus.mockRejectedValue(
      new Error('Prometheus query failed: 503')
    );
    const r = await interroga({ query: PROMQL });
    expect(r.status).toBe(502);
    await expect(r.json()).resolves.toEqual({
      available: true,
      error: 'Prometheus query failed: 503',
    });
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un guasto dell’intervallo segue la stessa strada', async () => {
    prometheus.queryPrometheusRange.mockRejectedValue('risposta illeggibile');
    const r = await interroga({ query: PROMQL, ...INTERVALLO });
    expect(r.status).toBe(502);
    await expect(r.json()).resolves.toEqual({
      available: true,
      error: 'Prometheus query failed',
    });
  });
});

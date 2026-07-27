import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./pubsub', () => ({ publishLiveState: vi.fn().mockResolvedValue(1) }));

import { publishLiveState, type LiveEnvelope } from './pubsub';

import { pokeLivePanel, publishEventStatus, publishFlagsIfChanged } from './publish';

const publish = publishLiveState as unknown as ReturnType<typeof vi.fn>;

const FLAG_BASE = {
  qaEnabled: true,
  chatEnabled: true,
  agendaEnabled: false,
  wordCloudEnabled: false,
  recordingEnabled: false,
};

/** L'ultima busta pubblicata, per ispezionarne il contenuto. */
function ultimaBusta(): LiveEnvelope {
  return publish.mock.calls[publish.mock.calls.length - 1]?.[1] as LiveEnvelope;
}

describe('publishFlagsIfChanged', () => {
  beforeEach(() => vi.clearAllMocks());

  it('non pubblica se nessun flag è cambiato', () => {
    // La rotta di modifica riceve anche i salvataggi del wizard, che rimanda
    // decine di campi: senza questo confronto un cambio di descrizione farebbe
    // rileggere i flag a tutta la sala.
    expect(publishFlagsIfChanged('evt-1', FLAG_BASE, { ...FLAG_BASE })).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('pubblica quando un flag cambia, con i valori nuovi', () => {
    const dopo = { ...FLAG_BASE, wordCloudEnabled: true };
    expect(publishFlagsIfChanged('evt-1', FLAG_BASE, dopo)).toBe(true);
    const busta = ultimaBusta();
    expect(busta.op).toBe('flags');
    if (busta.op === 'flags') expect(busta.flags).toEqual(dopo);
  });

  it('guarda tutti e cinque i flag, non solo il primo', () => {
    for (const campo of Object.keys(FLAG_BASE) as (keyof typeof FLAG_BASE)[]) {
      vi.clearAllMocks();
      const dopo = { ...FLAG_BASE, [campo]: !FLAG_BASE[campo] };
      expect(publishFlagsIfChanged('evt-1', FLAG_BASE, dopo), campo).toBe(true);
    }
  });

  it('ignora i campi che non sono flag della sala', () => {
    const prima = { ...FLAG_BASE, titolo: 'uno' } as never;
    const dopo = { ...FLAG_BASE, titolo: 'due' } as never;
    expect(publishFlagsIfChanged('evt-1', prima, dopo)).toBe(false);
  });
});

describe('pokeLivePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('annuncia il pannello e nient’altro', () => {
    // Il contenuto NON viaggia: la stessa rotta risponde diversamente a
    // seconda del ruolo, e un id qui direbbe a chi non può leggere che
    // qualcosa esiste.
    pokeLivePanel('evt-1', 'qa');
    const busta = ultimaBusta();
    expect(Object.keys(busta).sort()).toEqual(['op', 'panel', 'ts']);
    expect(busta).toMatchObject({ op: 'poke', panel: 'qa' });
  });
});

describe('publishEventStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('annuncia il nuovo stato', () => {
    publishEventStatus('evt-1', 'ENDED');
    expect(ultimaBusta()).toMatchObject({ op: 'eventStatus', status: 'ENDED' });
  });
});

describe('confine di ciò che viaggia sul canale', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nessuna busta porta dati per-utente o dipendenti dal ruolo', () => {
    // È l'unica difesa automatica contro la regressione che renderebbe
    // insicuro questo disegno: qualcuno aggiunge un campo "utile" allo
    // snapshot e la sala inizia a vedere lo stato di qualcun altro.
    const VIETATI = [
      'hasUpvoted',
      'myReaction',
      'votedOptionIndex',
      'optionCounts',
      'authorName',
      'displayName',
      'email',
      'token',
    ];
    publishFlagsIfChanged('evt-1', FLAG_BASE, { ...FLAG_BASE, qaEnabled: false });
    publishEventStatus('evt-1', 'LIVE');
    for (const pannello of ['qa', 'polls', 'agenda', 'wordcloud'] as const) {
      pokeLivePanel('evt-1', pannello);
    }

    const serializzate = publish.mock.calls.map((c) => JSON.stringify(c[1]));
    expect(serializzate).not.toHaveLength(0);
    for (const testo of serializzate) {
      for (const vietato of VIETATI) {
        expect(testo, `${vietato} in ${testo}`).not.toContain(vietato);
      }
    }
  });
});

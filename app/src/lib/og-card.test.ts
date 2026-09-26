import { describe, it, expect } from 'vitest';

import {
  accorcia,
  contenutoScheda,
  origineLocandina,
  type ImpostazioniScheda,
} from './og-card';

const impostazioni = (over: Partial<ImpostazioniScheda> = {}): ImpostazioniScheda => ({
  ogShowDate: true,
  ogShowSpeakers: true,
  ogShowOrganization: true,
  organizationName: 'Ente di esempio',
  defaultTimezone: 'Europe/Rome',
  primaryColor: '#0066CC',
  ...over,
});

const evento = (over: Record<string, unknown> = {}) => ({
  title: { it: 'Titolo di prova', en: 'Test title' },
  startsAt: new Date('2026-09-22T08:30:00.000Z'),
  speakersInfo: { it: 'Relatore 1, Relatore 2', en: 'Speaker 1, Speaker 2' },
  organizerName: null,
  ...over,
});

describe('accorcia', () => {
  it('lascia stare un testo che ci sta', () => {
    expect(accorcia('Titolo breve', 40)).toBe('Titolo breve');
  });

  it('taglia sullo spazio, non a meta’ parola', () => {
    const out = accorcia('Strategia nazionale per la trasformazione digitale', 20);
    expect(out).toBe('Strategia nazionale…');
  });

  it('una parola sola piu’ lunga del limite si taglia lo stesso', () => {
    // Senza questo ramo il taglio sullo spazio non troverebbe nulla e
    // restituirebbe una stringa vuota.
    expect(accorcia('Supercalifragilistichespiralidoso', 10)).toBe('Supercalif…');
  });

  it('normalizza gli a capo, che nella scheda diventerebbero spazi vuoti', () => {
    expect(accorcia('Primo\n\n  secondo', 40)).toBe('Primo secondo');
  });
});

describe('contenutoScheda', () => {
  it('prende titolo, data, relatori ed ente nella lingua richiesta', () => {
    const c = contenutoScheda(evento(), impostazioni(), 'it');
    expect(c.titolo).toBe('Titolo di prova');
    expect(c.relatori).toBe('Relatore 1, Relatore 2');
    expect(c.ente).toBe('Ente di esempio');
    expect(c.data).toContain('2026');
    // Fuso di Roma: le 08:30 UTC sono le 10:30 locali.
    expect(c.data).toContain('10:30');
  });

  it('ogni interruttore spento svuota il proprio campo', () => {
    const c = contenutoScheda(
      evento(),
      impostazioni({ ogShowDate: false, ogShowSpeakers: false, ogShowOrganization: false }),
      'it',
    );
    expect(c.data).toBe('');
    expect(c.relatori).toBe('');
    expect(c.ente).toBe('');
    // Il titolo non e' opzionale: senza, la scheda non direbbe niente.
    expect(c.titolo).toBe('Titolo di prova');
  });

  it('l’organizzatore dell’evento vince sul nome dell’ente', () => {
    const c = contenutoScheda(
      evento({ organizerName: 'Struttura ospitante' }),
      impostazioni(),
      'it',
    );
    expect(c.ente).toBe('Struttura ospitante');
  });

  it('un colore non valido non arriva nella scheda', () => {
    // Un valore sporco in configurazione renderebbe lo sfondo trasparente
    // invece che istituzionale, e l'anteprima sarebbe testo bianco sul nulla.
    for (const sporco of ['', 'rosso', '#GGG', '0066CC', '#0066CCFF']) {
      expect(contenutoScheda(evento(), impostazioni({ primaryColor: sporco }), 'it').colore).toBe(
        '#0066CC',
      );
    }
    expect(
      contenutoScheda(evento(), impostazioni({ primaryColor: '#AA1122' }), 'it').colore,
    ).toBe('#AA1122');
  });

  it('un fuso orario impossibile non fa saltare l’anteprima', () => {
    const c = contenutoScheda(evento(), impostazioni({ defaultTimezone: 'Marte/Olympus' }), 'it');
    expect(c.data).toContain('2026');
  });

  it('senza relatori la riga resta vuota invece di stampare un segnaposto', () => {
    const c = contenutoScheda(evento({ speakersInfo: {} }), impostazioni(), 'it');
    expect(c.relatori).toBe('');
  });
});

/**
 * Da dove si va a prendere la locandina. Due rischi distinti, stessa funzione:
 * l'anteprima che sparisce in produzione perche' il pod non riesce a uscire e
 * rientrare dal proprio ingresso, e la richiesta fatta fare al server verso un
 * indirizzo che non avrebbe dovuto raggiungere.
 */
describe('origineLocandina', () => {
  const BASE = 'https://webinar.gov.it';

  it('un percorso relativo diventa una lettura su loopback', () => {
    expect(origineLocandina('/api/assets/locandina.png', BASE, '3000')).toEqual({
      tipo: 'interna',
      url: 'http://127.0.0.1:3000/api/assets/locandina.png',
    });
  });

  it('il proprio indirizzo pubblico non esce dal pod', () => {
    // E' il caso NORMALE: i file caricati dal pannello sono salvati con
    // l'indirizzo pubblico. Uscire e rientrare dall'ingresso non funziona in
    // molte reti, e la locandina sparirebbe funzionando in sviluppo.
    expect(
      origineLocandina(`${BASE}/api/assets/x.png?v=2`, BASE, '8080'),
    ).toEqual({ tipo: 'interna', url: 'http://127.0.0.1:8080/api/assets/x.png?v=2' });
  });

  it('un indirizzo esterno resta esterno', () => {
    expect(origineLocandina('https://cdn.example.org/a.jpg', BASE, '3000')).toEqual({
      tipo: 'esterna',
      url: 'https://cdn.example.org/a.jpg',
    });
  });

  it('gli indirizzi privati e i nomi interni non diventano richieste', () => {
    for (const cattivo of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:9000/interno',
      'http://10.0.0.5/a.png',
      'http://172.16.3.4/a.png',
      'http://192.168.1.9/a.png',
      'http://localhost:5432/a.png',
      'http://prosody.videocall.svc/a.png',
      'http://qualcosa.internal/a.png',
      'http://[::1]/a.png',
    ]) {
      expect(origineLocandina(cattivo, BASE, '3000'), cattivo).toBeNull();
    }
  });

  it('solo http e https', () => {
    for (const schema of [
      'file:///etc/passwd',
      'data:image/png;base64,AAAA',
      'gopher://x/a',
    ]) {
      expect(origineLocandina(schema, BASE, '3000'), schema).toBeNull();
    }
  });

  it('vuoto, spazi e indirizzi malformati non sono una locandina', () => {
    for (const niente of [null, undefined, '', '   ', 'http://']) {
      expect(origineLocandina(niente, BASE, '3000')).toBeNull();
    }
  });

  it('senza indirizzo pubblico configurato, un percorso resta interno', () => {
    expect(origineLocandina('/a.png', null, '3000')).toEqual({
      tipo: 'interna',
      url: 'http://127.0.0.1:3000/a.png',
    });
  });
});

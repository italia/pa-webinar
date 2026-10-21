import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import FileOrUrlInput, { formatoLeggibile, linkValido } from './file-or-url-input';
import { UploadsAvailabilityProvider } from './uploads-availability';

/**
 * Il campo «file o link» dell'area admin: un solo pulsante per scegliere il
 * file, il riquadro come zona di rilascio, il link sempre in vista, il
 * caricamento con avanzamento e annullamento, gli errori nella lingua della
 * pagina. Il caricamento passa da XMLHttpRequest: qui lo sostituisce un finto
 * che i test fanno avanzare e rispondere.
 */
const t = messages.admin.fileOrUrl;
const ORIGINE = window.location.origin;
const URL_CARICATO = `${ORIGINE}/api/assets/image/2026/10/0b0e1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d-copertina.jpg`;

class XhrFinto {
  static tutti: XhrFinto[] = [];
  upload: {
    onprogress:
      ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  url = '';
  corpo: unknown = null;
  annullato = false;
  constructor() {
    XhrFinto.tutti.push(this);
  }
  open(_metodo: string, url: string) {
    this.url = url;
  }
  send(corpo: unknown) {
    this.corpo = corpo;
  }
  abort() {
    this.annullato = true;
    this.onabort?.();
  }
  avanza(percentuale: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: percentuale, total: 100 });
  }
  rispondi(status: number, corpo: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(corpo);
    this.onload?.();
  }
  cade() {
    this.onerror?.();
  }
}

function ultimoXhr(): XhrFinto {
  const x = XhrFinto.tutti[XhrFinto.tutti.length - 1];
  if (!x) throw new Error('nessun caricamento partito');
  return x;
}

let misura = { w: 1600, h: 900 };
class ImmagineFinta {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    this.naturalWidth = misura.w;
    this.naturalHeight = misura.h;
    setTimeout(() => this.onload?.(), 0);
  }
}

let container: HTMLDivElement;
let root: Root;

function disegna(children: ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        {children}
      </NextIntlClientProvider>
    );
  });
}

async function svuota() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function fileImmagine(nome = 'logo.png', tipo = 'image/png', peso?: number): File {
  const f = new File([new Uint8Array([1])], nome, { type: tipo });
  if (peso !== undefined) Object.defineProperty(f, 'size', { value: peso });
  return f;
}

function inputFile(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('selettore di file non trovato');
  return input;
}

/** Sceglie un file nel selettore nascosto. */
async function scegliFile(file: File = fileImmagine()) {
  const input = inputFile();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await svuota();
}

function linkInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[id*="-url-"]');
}

function scrivi(input: HTMLInputElement, testo: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  act(() => {
    setter.call(input, testo);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pulsante(testo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === testo
  );
}

function stato(): string {
  return container.querySelector('[role="status"]')?.textContent ?? '';
}

function trascina(el: Element, tipo: string, files: File[]) {
  const evento = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperty(evento, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  });
  act(() => {
    el.dispatchEvent(evento);
  });
  return evento;
}

function risposta(
  meta: Partial<{ url: string; mime: string; size: number; filename: string }> = {}
) {
  return {
    url: URL_CARICATO,
    key: 'assets/image/2026/10/x-copertina.jpg',
    mime: 'image/jpeg',
    size: 73728,
    filename: 'copertina.jpg',
    ...meta,
  };
}

/** Il campo con il valore tenuto da un modulo, come lo usano le pagine. */
function Modulo({
  iniziale = null,
  onChange,
  onUpload,
  ...resto
}: {
  iniziale?: string | null;
  onChange?: (v: string | null) => void;
  onUpload?: (m: unknown) => void;
  assetType?: 'image' | 'audio' | 'document';
  ritaglio?: { rapporto: number; larghezza: number };
  avvisoImmagineEsterna?: boolean;
  immagineAmmessa?: (u: string) => boolean | string | null;
  id?: string;
}) {
  const [v, setV] = useState<string | null>(iniziale);
  return (
    <FileOrUrlInput
      id={resto.id ?? 'logo'}
      label="Logo"
      value={v}
      onChange={(n) => {
        onChange?.(n);
        setV(n);
      }}
      onUpload={onUpload}
      assetType={resto.assetType ?? 'image'}
      ritaglio={resto.ritaglio}
      avvisoImmagineEsterna={resto.avvisoImmagineEsterna}
      immagineAmmessa={resto.immagineAmmessa}
    />
  );
}

function senzaCaricamento(children: ReactNode, reason?: 'storage' | 'sessione') {
  return (
    <UploadsAvailabilityProvider available={false} reason={reason}>
      {children}
    </UploadsAvailabilityProvider>
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  XhrFinto.tutti = [];
  misura = { w: 1600, h: 900 };
  vi.stubGlobal('XMLHttpRequest', XhrFinto);
  vi.stubGlobal('Image', ImmagineFinta);
  URL.createObjectURL = () => 'blob:prova';
  URL.revokeObjectURL = () => {};
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('il campo vuoto', () => {
  it("ha un solo pulsante, niente schede, e il selettore vero e' nascosto", () => {
    disegna(<Modulo />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    const pulsanti = Array.from(container.querySelectorAll('button'));
    expect(pulsanti.map((b) => b.textContent?.trim())).toEqual([t.choose]);
    const input = inputFile();
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.tabIndex).toBe(-1);
  });

  it("il pulsante porta nel nome l'etichetta del campo e nella descrizione i formati", () => {
    disegna(<Modulo />);
    const scegli = pulsante(t.choose)!;
    const nomi = scegli.getAttribute('aria-labelledby')!.split(' ');
    expect(nomi[0]).toBe(scegli.id);
    expect(document.getElementById(nomi[1]!)?.textContent).toBe('Logo');
    const descrizione = document.getElementById(scegli.getAttribute('aria-describedby')!);
    expect(descrizione?.textContent).toContain('fino a 10');
    expect(descrizione?.textContent).toContain('JPEG, PNG, WebP, SVG o GIF');
  });

  it("il gruppo e' etichettato dal nome del campo", () => {
    disegna(<Modulo />);
    const gruppo = container.querySelector('[role="group"]')!;
    expect(
      document.getElementById(gruppo.getAttribute('aria-labelledby')!)?.textContent
    ).toBe('Logo');
  });

  it('un clic sul riquadro apre il selettore; il clic sul pulsante lo apre una volta sola', () => {
    disegna(<Modulo ritaglio={{ rapporto: 16 / 9, larghezza: 1600 }} />);
    const apri = vi.spyOn(inputFile(), 'click').mockImplementation(() => {});
    const zona = container.querySelector('.campo-file__zona')!;
    act(() => {
      (zona.querySelector('.campo-file__formati') as HTMLElement).click();
    });
    expect(apri).toHaveBeenCalledTimes(1);
    act(() => pulsante(t.choose)!.click());
    expect(apri).toHaveBeenCalledTimes(2);
  });

  it('la copertina dice il formato del ritaglio', () => {
    disegna(<Modulo ritaglio={{ rapporto: 16 / 9, larghezza: 1600 }} />);
    expect(container.textContent).toContain(
      'Se non è in 16:9 la ritagli prima del caricamento.'
    );
  });
});

describe('trascinare un file', () => {
  it('un file rilasciato sul riquadro si carica', async () => {
    disegna(<Modulo />);
    const zona = container.querySelector('.campo-file__zona')!;
    trascina(zona, 'drop', [fileImmagine()]);
    await svuota();
    expect(XhrFinto.tutti).toHaveLength(1);
    expect(ultimoXhr().url).toBe('/api/admin/assets/upload-url?type=image');
  });

  it('due file insieme: nessuno parte, e si dice di trascinarne uno', async () => {
    disegna(<Modulo />);
    const zona = container.querySelector('.campo-file__zona')!;
    trascina(zona, 'drop', [fileImmagine('a.png'), fileImmagine('b.png')]);
    await svuota();
    expect(XhrFinto.tutti).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      t.errorOneFile
    );
  });

  it("il riquadro cambia mentre ci si trascina sopra un file, e torna com'era", () => {
    disegna(<Modulo ritaglio={{ rapporto: 16 / 9, larghezza: 1600 }} />);
    // Si entra dal pulsante, che sparisce mentre si trascina: la sua uscita
    // non arrivera' mai. Conta solo l'uscita dal velo.
    const scegli = pulsante(t.choose)!;
    trascina(scegli, 'dragenter', []);
    const zona = container.querySelector('.campo-file__zona')!;
    expect(zona.classList).toContain('is-sopra');
    expect(container.textContent).toContain(t.dropRelease);
    expect(pulsante(t.choose)).toBeUndefined();
    trascina(zona, 'dragleave', []);
    expect(container.querySelector('.campo-file__zona')!.classList).toContain('is-sopra');
    trascina(container.querySelector('.campo-file__cattura')!, 'dragleave', []);
    expect(container.querySelector('.campo-file__zona')!.classList).not.toContain(
      'is-sopra'
    );
  });

  it('un file lasciato fuori dal riquadro non apre la scheda al posto del modulo', () => {
    disegna(<Modulo />);
    const evento = trascina(document.body, 'drop', [fileImmagine()]);
    expect(evento.defaultPrevented).toBe(true);
  });
});

describe("controlli prima dell'invio", () => {
  it('un file troppo grande si ferma nel browser', async () => {
    disegna(<Modulo />);
    // Appena sopra il limite: il peso si arrotonda per eccesso, per non
    // leggere «pesa 10 MB: il massimo è 10 MB».
    await scegliFile(fileImmagine('enorme.png', 'image/png', 10 * 1024 * 1024 + 30_000));
    expect(XhrFinto.tutti).toHaveLength(0);
    const avviso = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(avviso).toContain('«enorme.png» pesa 10,1\u00a0MB');
    expect(avviso).toContain('qui il massimo è 10\u00a0MB');
  });

  it('un formato che non si usa si ferma nel browser', async () => {
    disegna(<Modulo />);
    await scegliFile(fileImmagine('foto.heic', 'image/heic'));
    expect(XhrFinto.tutti).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '«foto.heic» non è in un formato che si può usare qui'
    );
  });
});

describe('il caricamento', () => {
  it("mostra l'avanzamento e si annulla lasciando il valore di prima", async () => {
    const cambia = vi.fn();
    disegna(<Modulo onChange={cambia} />);
    await scegliFile();
    expect(stato()).toBe('Caricamento di logo.png in corso.');
    act(() => ultimoXhr().avanza(45));
    const barra = container.querySelector('[role="progressbar"]')!;
    expect(barra.getAttribute('aria-valuenow')).toBe('45');
    expect(container.textContent).toContain('Caricamento… 45%');
    act(() => pulsante(t.cancelUpload)!.click());
    await svuota();
    expect(ultimoXhr().annullato).toBe(true);
    expect(cambia).not.toHaveBeenCalled();
    expect(stato()).toBe(t.cancelledSr);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('riuscito: prima il valore, poi i dati del file; mai un indirizzo blob', async () => {
    const ordine: string[] = [];
    disegna(
      <Modulo
        onChange={(v) => ordine.push(`change:${v}`)}
        onUpload={() => ordine.push('upload')}
      />
    );
    await scegliFile();
    act(() => ultimoXhr().rispondi(200, risposta()));
    await svuota();
    expect(ordine).toEqual([`change:${URL_CARICATO}`, 'upload']);
    expect(ordine.join()).not.toContain('blob:');
    expect(stato()).toBe('copertina.jpg caricato.');
    expect(container.textContent).toContain('copertina.jpg');
    expect(container.textContent).toContain('72\u00a0kB');
  });

  it('il fuoco passa a «Sostituisci» se era nel campo', async () => {
    disegna(<Modulo />);
    pulsante(t.choose)!.focus();
    await scegliFile();
    act(() => ultimoXhr().rispondi(200, risposta()));
    await svuota();
    expect(document.activeElement?.textContent?.trim()).toBe(t.replace);
  });

  it("il fuoco resta dove l'ha portato chi compila, se e' andato altrove", async () => {
    const altro = document.createElement('input');
    document.body.appendChild(altro);
    try {
      disegna(<Modulo />);
      await scegliFile();
      altro.focus();
      act(() => ultimoXhr().rispondi(200, risposta()));
      await svuota();
      expect(document.activeElement).toBe(altro);
    } finally {
      altro.remove();
    }
  });

  it('durante il caricamento il link aspetta, e chi usa il campo lo sa', async () => {
    const occupato = vi.fn();
    disegna(
      <FileOrUrlInput
        id="logo"
        label="Logo"
        value={null}
        onChange={vi.fn()}
        assetType="image"
        onBusy={occupato}
      />
    );
    await scegliFile();
    expect(linkInput()!.disabled).toBe(true);
    expect(occupato).toHaveBeenLastCalledWith(true);
    act(() => ultimoXhr().rispondi(200, risposta()));
    await svuota();
    expect(occupato).toHaveBeenLastCalledWith(false);
  });

  it('«Rimuovi» svuota il campo, lo annuncia e porta il fuoco su «Scegli»', () => {
    const cambia = vi.fn();
    disegna(<Modulo iniziale={URL_CARICATO} onChange={cambia} />);
    act(() => pulsante(t.remove)!.click());
    expect(cambia).toHaveBeenCalledWith(null);
    expect(stato()).toBe('Rimosso: Logo.');
    expect(document.activeElement?.textContent?.trim()).toBe(t.choose);
  });
});

describe('errori del server', () => {
  async function conRisposta(status: number, corpo: unknown) {
    disegna(<Modulo />);
    await scegliFile();
    act(() => ultimoXhr().rispondi(status, corpo));
    await svuota();
    return container.querySelector('[role="alert"]')?.textContent ?? '';
  }

  it("401: serve l'accesso dello staff", async () => {
    expect(await conRisposta(401, { error: 'Unauthorized' })).toContain(t.errorAuth);
  });

  it('429: troppi caricamenti', async () => {
    expect(await conRisposta(429, { error: 'Too many' })).toContain(t.errorRate);
  });

  it('il testo del server non si mostra mai', async () => {
    const testo = await conRisposta(422, {
      error: 'Messaggio del server',
      code: 'VALIDATION_ERROR',
    });
    expect(testo).toContain(t.errorGeneric);
    expect(testo).not.toContain('Messaggio del server');
    expect(pulsante(t.retry)).toBeUndefined();
  });

  it('STORAGE_UNAVAILABLE lo dice nella lingua della pagina', async () => {
    expect(
      await conRisposta(503, {
        error: 'Files storage is not configured.',
        code: 'STORAGE_UNAVAILABLE',
      })
    ).toContain(t.uploadsUnavailable);
  });

  it("un server giu' o la rete assente offrono «Riprova», che rimanda lo stesso file", async () => {
    disegna(<Modulo />);
    await scegliFile();
    act(() => ultimoXhr().cade());
    await svuota();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      t.errorGeneric
    );
    act(() => pulsante(t.retry)!.click());
    await svuota();
    expect(XhrFinto.tutti).toHaveLength(2);
    const corpo = ultimoXhr().corpo as FormData;
    expect((corpo.get('file') as File).name).toBe('logo.png');
  });

  it('dopo un errore il fuoco va su «Riprova», non sulla pagina', async () => {
    disegna(<Modulo />);
    await scegliFile();
    pulsante(t.cancelUpload)!.focus();
    act(() => ultimoXhr().rispondi(500, { error: 'boom' }));
    await svuota();
    expect(document.activeElement?.textContent?.trim()).toBe(t.retry);
  });

  it('un errore vecchio sparisce quando si incolla un link valido', async () => {
    disegna(<Modulo />);
    await scegliFile();
    act(() => ultimoXhr().rispondi(415, { error: 'no' }));
    await svuota();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    scrivi(linkInput()!, 'https://www.ente.it/logo.png');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('il link', () => {
  it("la casella non riscrive chi digita e non passa al modulo un indirizzo a meta'", () => {
    const cambia = vi.fn();
    disegna(<Modulo onChange={cambia} />);
    const link = linkInput()!;
    scrivi(link, 'w');
    expect(link.value).toBe('w');
    expect(cambia).not.toHaveBeenCalled();
  });

  it("senza schema vale https://, e la casella resta come la si e' scritta", () => {
    const cambia = vi.fn();
    disegna(<Modulo onChange={cambia} />);
    const link = linkInput()!;
    scrivi(link, 'www.ente.it/a.png');
    expect(cambia).toHaveBeenLastCalledWith('https://www.ente.it/a.png');
    expect(linkInput()!.value).toBe('www.ente.it/a.png');
  });

  it('un indirizzo con spazi non passa e, uscendo, lo si dice sul campo', () => {
    const cambia = vi.fn();
    disegna(<Modulo onChange={cambia} />);
    const link = linkInput()!;
    scrivi(link, 'https://pagina non valida');
    expect(cambia).not.toHaveBeenCalled();
    act(() => {
      link.focus();
      link.blur();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      t.invalidUrl
    );
    expect(linkInput()!.getAttribute('aria-invalid')).toBe('true');
  });

  it("l'anteprima arriva uscendo dal campo o con Invio, non a ogni battuta", () => {
    disegna(<Modulo />);
    const link = linkInput()!;
    scrivi(link, `${ORIGINE}/api/assets/image/logo.png`);
    expect(container.querySelector('.campo-file__miniatura img')).toBeNull();
    act(() => {
      link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(
      container.querySelector('.campo-file__miniatura img')?.getAttribute('src')
    ).toBe(`${ORIGINE}/api/assets/image/logo.png`);
    // Il link resta in vista: lo si sta scrivendo.
    expect(linkInput()).not.toBeNull();
  });

  it("«Rimuovi» subito dopo aver cambiato il link: l'anteprima rimandata non lo riporta", async () => {
    const cambia = vi.fn();
    disegna(<Modulo iniziale={`${ORIGINE}/loghi/a.png`} onChange={cambia} />);
    scrivi(linkInput()!, `${ORIGINE}/loghi/b.png`);
    act(() => pulsante(t.remove)!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(cambia).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('.campo-file__miniatura img')).toBeNull();
    expect(linkInput()!.value).toBe('');
  });

  it('uscire da un link mai toccato non cambia il valore', () => {
    const cambia = vi.fn();
    disegna(<Modulo iniziale="https://www.ente.it/logo.png" onChange={cambia} />);
    act(() => {
      linkInput()!.focus();
      linkInput()!.blur();
    });
    expect(cambia).not.toHaveBeenCalled();
  });

  it('un file caricato non si cancella passando per il link (i materiali: FILE resta FILE)', async () => {
    const cambia = vi.fn();
    const caricato = vi.fn();
    disegna(<Modulo assetType="document" onChange={cambia} onUpload={caricato} />);
    await scegliFile(
      new File([new Uint8Array([1])], 'programma.pdf', { type: 'application/pdf' })
    );
    act(() =>
      ultimoXhr().rispondi(
        200,
        risposta({
          url: `${ORIGINE}/api/assets/document/programma.pdf`,
          mime: 'application/pdf',
          filename: 'programma.pdf',
        })
      )
    );
    await svuota();
    expect(cambia).toHaveBeenCalledTimes(1);
    expect(caricato).toHaveBeenCalledTimes(1);
    // Il file viene dal portale: niente casella del link da cui uscire.
    expect(linkInput()).toBeNull();
    const nome = container.querySelector<HTMLAnchorElement>('a.campo-file__nome')!;
    expect(nome.textContent).toContain('programma.pdf');
    expect(nome.target).toBe('_blank');
  });

  it('la casella resta vuota per un file del portale e mostra un link esterno', () => {
    disegna(<Modulo iniziale={URL_CARICATO} />);
    expect(linkInput()).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    disegna(<Modulo iniziale="https://i.ytimg.com/vi/abc/hqdefault.jpg" />);
    expect(linkInput()!.value).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
  });

  it('un valore azzerato da fuori dopo un caricamento svuota il campo', async () => {
    // Il modulo che si azzera dopo «Aggiungi» (un materiale, il logo di una
    // persona nuova): il file di prima non resta in vista.
    let azzera: () => void = () => {};
    function Azzerabile() {
      const [v, setV] = useState<string | null>(null);
      azzera = () => setV(null);
      return (
        <FileOrUrlInput
          id="doc"
          label="Documento"
          value={v}
          onChange={setV}
          assetType="document"
        />
      );
    }
    disegna(<Azzerabile />);
    await scegliFile(
      new File([new Uint8Array([1])], 'slide.pdf', { type: 'application/pdf' })
    );
    act(() =>
      ultimoXhr().rispondi(
        200,
        risposta({
          url: `${ORIGINE}/api/assets/document/slide.pdf`,
          mime: 'application/pdf',
          filename: 'slide.pdf',
        })
      )
    );
    await svuota();
    const zona = () => container.querySelector('.campo-file__zona')!.textContent;
    expect(zona()).toContain('slide.pdf');
    expect(linkInput()).toBeNull();

    act(() => azzera());
    expect(zona()).not.toContain('slide.pdf');
    expect(pulsante(t.remove)).toBeUndefined();
    expect(pulsante(t.choose)).toBeDefined();
    expect(linkInput()!.value).toBe('');
  });

  it('un file del portale tolto da fuori non resta in vista', () => {
    const campo = (v: string | null) => (
      <FileOrUrlInput id="doc" label="Documento" value={v} onChange={vi.fn()} assetType="document" />
    );
    disegna(campo(`${ORIGINE}/api/assets/document/slide.pdf`));
    expect(container.textContent).toContain('slide.pdf');
    disegna(campo(null));
    expect(container.textContent).not.toContain('slide.pdf');
    expect(pulsante(t.remove)).toBeUndefined();
  });

  it('un link scritto e poi azzerato da fuori svuota la casella', () => {
    let azzera: () => void = () => {};
    function Azzerabile() {
      const [v, setV] = useState<string | null>(null);
      azzera = () => setV(null);
      return (
        <FileOrUrlInput id="doc" label="Documento" value={v} onChange={setV} assetType="document" />
      );
    }
    disegna(<Azzerabile />);
    scrivi(linkInput()!, 'https://www.ente.it/programma.pdf');
    // L'eco del valore non riscrive chi digita.
    expect(linkInput()!.value).toBe('https://www.ente.it/programma.pdf');
    act(() => azzera());
    expect(linkInput()!.value).toBe('');
  });

  it('segue il valore arrivato dopo il primo disegno', () => {
    const campo = (v: string | null) => (
      <FileOrUrlInput
        id="logo"
        label="Logo"
        value={v}
        onChange={vi.fn()}
        assetType="image"
      />
    );
    disegna(senzaCaricamento(campo(null)));
    disegna(senzaCaricamento(campo('https://example.org/logo.png')));
    expect(linkInput()!.value).toBe('https://example.org/logo.png');
  });
});

describe("dove non si puo' caricare", () => {
  it('senza storage resta il link, con il motivo', () => {
    disegna(senzaCaricamento(<Modulo />));
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(pulsante(t.choose)).toBeUndefined();
    expect(container.textContent).toContain(t.uploadsUnavailable);
    expect(container.textContent).toContain(t.linkOnly);
  });

  it("con il solo link di conduzione si dice che il caricamento e' dello staff", () => {
    disegna(senzaCaricamento(<Modulo />, 'sessione'));
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toContain(t.uploadsStaffOnly);
    expect(container.textContent).not.toContain(t.uploadsUnavailable);
  });

  it("fuori dal provider il caricamento e' offerto, come sempre", () => {
    disegna(<Modulo />);
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).not.toContain(t.uploadsUnavailable);
  });
});

describe('il campo che esce dal modulo, e il modulo che cambia', () => {
  it("tolto durante il caricamento: l'invio si interrompe e il modulo non riceve niente", async () => {
    const cambia = vi.fn();
    disegna(<Modulo onChange={cambia} />);
    await scegliFile();
    const xhr = ultimoXhr();
    disegna(<div />);
    expect(xhr.annullato).toBe(true);
    await svuota();
    expect(cambia).not.toHaveBeenCalled();
  });

  it("alla fine del caricamento vale la funzione dell'ultimo disegno", async () => {
    const prima = vi.fn();
    const dopo = vi.fn();
    const campo = (onChange: (v: string | null) => void) => (
      <FileOrUrlInput
        id="logo"
        label="Logo"
        value={null}
        onChange={onChange}
        assetType="image"
      />
    );
    disegna(campo(prima));
    await scegliFile();
    disegna(campo(dopo));
    act(() => ultimoXhr().rispondi(200, risposta()));
    await svuota();
    expect(prima).not.toHaveBeenCalled();
    expect(dopo).toHaveBeenCalledWith(URL_CARICATO);
  });

  it('il sito scritto mentre il logo si carica non si perde', async () => {
    // Lo stesso schema degli enti nel passo Persone: la bozza si ricostruisce
    // dalla chiusura del disegno in corso.
    let bozzaFinale: { sito: string; logo: string | null } | null = null;
    function Ente() {
      const [bozza, setBozza] = useState<{ sito: string; logo: string | null }>({
        sito: '',
        logo: null,
      });
      bozzaFinale = bozza;
      return (
        <>
          <input
            id="sito"
            value={bozza.sito}
            onChange={(e) => setBozza({ ...bozza, sito: e.target.value })}
          />
          <FileOrUrlInput
            id="org-logo"
            label="Logo"
            value={bozza.logo}
            onChange={(v) => setBozza({ ...bozza, logo: v })}
            assetType="image"
          />
        </>
      );
    }
    disegna(<Ente />);
    await scegliFile();
    scrivi(
      document.getElementById('sito') as HTMLInputElement,
      'https://www.ente-di-prova.example'
    );
    act(() => ultimoXhr().rispondi(200, risposta()));
    await svuota();
    expect(bozzaFinale).toEqual({
      sito: 'https://www.ente-di-prova.example',
      logo: URL_CARICATO,
    });
  });
});

describe('formato richiesto: il ritaglio prima del caricamento', () => {
  const copertina = (ritaglio?: { rapporto: number; larghezza: number }) => (
    <Modulo ritaglio={ritaglio} />
  );

  it("un'immagine gia' 16:9 si carica com'e'", async () => {
    misura = { w: 1600, h: 900 };
    disegna(copertina({ rapporto: 16 / 9, larghezza: 1600 }));
    await scegliFile(fileImmagine('a.png'));
    expect(XhrFinto.tutti).toHaveLength(1);
    expect(document.body.textContent).not.toContain(t.crop.title);
  });

  it("un'immagine di altro formato apre il ritaglio; annullando non si carica niente", async () => {
    misura = { w: 1000, h: 1000 };
    disegna(copertina({ rapporto: 16 / 9, larghezza: 1600 }));
    await scegliFile(fileImmagine('a.png'));
    expect(XhrFinto.tutti).toHaveLength(0);
    expect(document.body.textContent).toContain(t.crop.title);
    const annulla = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === t.crop.cancel
    )!;
    await act(async () => annulla.click());
    await svuota();
    expect(XhrFinto.tutti).toHaveLength(0);
  });

  it('senza formato richiesto nessun ritaglio, qualunque sia la forma', async () => {
    misura = { w: 1000, h: 1000 };
    disegna(copertina());
    await scegliFile(fileImmagine('a.png'));
    expect(XhrFinto.tutti).toHaveLength(1);
  });

  it('un SVG non si ritaglia: si carica e il campo lo dice', async () => {
    misura = { w: 1000, h: 1000 };
    disegna(copertina({ rapporto: 16 / 9, larghezza: 1600 }));
    await scegliFile(fileImmagine('logo.svg', 'image/svg+xml'));
    expect(document.body.textContent).not.toContain(t.crop.title);
    act(() =>
      ultimoXhr().rispondi(
        200,
        risposta({
          url: `${ORIGINE}/api/assets/image/logo.svg`,
          mime: 'image/svg+xml',
          filename: 'logo.svg',
        })
      )
    );
    await svuota();
    expect(container.textContent).toContain(t.svgNoCrop);
  });

  it("un'immagine nel formato ma piccola si carica, con l'avviso che potrebbe sgranarsi", async () => {
    misura = { w: 800, h: 450 };
    disegna(copertina({ rapporto: 16 / 9, larghezza: 1600 }));
    await scegliFile(fileImmagine('piccola.png'));
    act(() => ultimoXhr().rispondi(200, risposta()));
    await svuota();
    expect(container.textContent).toContain(t.crop.small);
  });
});

describe('immagini di altri siti', () => {
  it("un'immagine di un altro sito: il riquadro avvisa invece di un'anteprima rotta", () => {
    disegna(
      <Modulo
        iniziale="https://altro-sito.example/copertina.png"
        ritaglio={{ rapporto: 16 / 9, larghezza: 1600 }}
      />
    );
    expect(container.textContent).toContain(t.externalTitle);
    expect(container.textContent).toContain(t.externalHint);
    expect(container.querySelector('.campo-file__zona img')).toBeNull();
    // Il pulsante per caricarla al suo posto e' dentro l'avviso.
    expect(pulsante(t.choose)).toBeDefined();
  });

  it("nessun avviso per un'immagine servita dal portale", () => {
    disegna(<Modulo iniziale={`${ORIGINE}/api/files/copertina.png`} />);
    expect(container.textContent).not.toContain(t.externalTitle);
  });

  it("un file servito da un'altra installazione e' esterno anche se il percorso e' /api/assets/", () => {
    disegna(<Modulo iniziale="https://altra-pa.example/api/assets/logo.png" />);
    expect(container.textContent).toContain(t.externalTitle);
    // Il link resta in vista per correggerlo.
    expect(linkInput()!.value).toBe('https://altra-pa.example/api/assets/logo.png');
  });

  it('le anteprime di YouTube, ammesse dalla CSP, non avvisano', () => {
    disegna(<Modulo iniziale="https://i.ytimg.com/vi/abc/hqdefault.jpg" />);
    expect(container.textContent).not.toContain(t.externalTitle);
  });

  it("un campo che non finisce nelle pagine puo' fare a meno dell'avviso", () => {
    disegna(
      <Modulo
        iniziale="https://altro-sito.example/anteprima.png"
        avvisoImmagineEsterna={false}
      />
    );
    expect(container.textContent).not.toContain(t.externalTitle);
    expect(container.textContent).toContain(t.linkAny);
  });

  it("vale la regola passata dal chiamante, e l'avviso e' citato dal link", () => {
    const soloAsset = (u: string) =>
      u.startsWith('/api/assets/') || u.includes('://ente.example/api/assets/');
    disegna(
      <Modulo
        iniziale="https://ente.example/api/assets/logo.png"
        immagineAmmessa={soloAsset}
      />
    );
    expect(container.textContent).not.toContain(t.externalTitle);
    act(() => root.unmount());
    root = createRoot(container);
    disegna(
      <Modulo iniziale={`${ORIGINE}/loghi/logo.png`} immagineAmmessa={soloAsset} />
    );
    expect(container.textContent).toContain(t.externalTitle);
    const descritto = linkInput()!.getAttribute('aria-describedby')!;
    expect(document.getElementById(descritto)?.textContent).toBe(t.externalHint);
  });

  it("senza caricamento l'avviso consiglia il link di un'immagine del portale", () => {
    disegna(
      senzaCaricamento(<Modulo iniziale="https://altro-sito.example/copertina.png" />)
    );
    expect(container.textContent).toContain(t.externalHintLink);
    expect(container.textContent).not.toContain(t.externalHint);
  });

  it("nessun avviso per un indirizzo relativo o un'immagine inline", () => {
    disegna(<Modulo iniziale="/api/files/copertina.png" />);
    expect(container.textContent).not.toContain(t.externalTitle);
    act(() => root.unmount());
    root = createRoot(container);
    disegna(<Modulo iniziale="data:image/png;base64,iVBORw0KGgo=" />);
    expect(container.textContent).not.toContain(t.externalTitle);
  });
});

describe("un'immagine che non si riesce a mostrare", () => {
  it("lo si dice, e il file si puo' sostituire o togliere", () => {
    const cambia = vi.fn();
    disegna(
      <Modulo iniziale={`${ORIGINE}/api/assets/image/sparita.png`} onChange={cambia} />
    );
    const img = container.querySelector('.campo-file__miniatura img')!;
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(container.textContent).toContain(t.linkBroken);
    expect(pulsante(t.choose)).toBeDefined();
    act(() => pulsante(t.remove)!.click());
    expect(cambia).toHaveBeenCalledWith(null);
    expect(container.textContent).not.toContain(t.linkBroken);
  });

  it("un'immagine di un altro sito per i social mostra il nome, non un'anteprima rotta", () => {
    disegna(
      <Modulo
        iniziale="https://altro-sito.example/og.png"
        avvisoImmagineEsterna={false}
      />
    );
    expect(container.querySelector('.campo-file__miniatura img')).toBeNull();
    expect(container.textContent).toContain('og.png');
    expect(container.textContent).not.toContain(t.linkBroken);
  });
});

describe('le impostazioni del sito portano il fuoco sul campo dopo un errore', () => {
  /** La ricerca di site-settings-form dopo un 422 su un campo. */
  function cercaCampo(id: string): HTMLElement | null {
    return (
      document.getElementById(id) ??
      document.querySelector<HTMLElement>(`[id^="${id}-url-"]`) ??
      document.querySelector<HTMLElement>(`[data-testid="${id}"] input`)
    );
  }

  it("trova la casella del link, e la sua prima etichetta e' il nome del campo", () => {
    disegna(<Modulo id="logoUrl" iniziale="https://www.ente.it/logo.png" />);
    const el = cercaCampo('logoUrl');
    expect(el).toBe(linkInput());
    expect(document.querySelector(`label[for="${el!.id}"]`)?.textContent?.trim()).toBe(
      'Logo'
    );
  });

  it('non porta mai il fuoco sul selettore nascosto', () => {
    disegna(<Modulo id="logoUrl" iniziale={URL_CARICATO} />);
    const el = cercaCampo('logoUrl');
    expect(el?.getAttribute('type')).not.toBe('file');
  });
});

describe('regole del link e del formato', () => {
  it('link validi e non', () => {
    expect(linkValido('https://www.ente.it/a.png')).toBe(true);
    expect(linkValido('http://localhost:3000/a.png')).toBe(true);
    expect(linkValido('http://[::1]/a.png')).toBe(true);
    expect(linkValido('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(linkValido('https://pagina non valida')).toBe(false);
    expect(linkValido('https://w')).toBe(false);
    expect(linkValido('ftp://www.ente.it/a.png')).toBe(false);
    expect(linkValido('javascript:alert(1)')).toBe(false);
  });

  it('il rapporto come lo si dice', () => {
    expect(formatoLeggibile(16 / 9)).toBe('16:9');
    expect(formatoLeggibile(1)).toBe('1:1');
    expect(formatoLeggibile(4 / 3)).toBe('4:3');
  });
});

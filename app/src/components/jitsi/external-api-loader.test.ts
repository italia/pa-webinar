// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXTERNAL_API_ATTR, loadExternalApi } from './external-api-loader';

/**
 * Il «Riprova» della sala funziona solo se un tentativo fallito non lascia in
 * pagina un tag che il tentativo dopo aspetterebbe per sempre.
 */
const DOMAIN = 'conferenza.example.gov.it';

const tags = () =>
  Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[${EXTERNAL_API_ATTR}]`));

function defineApi() {
  (window as unknown as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI = function Api() {};
}

beforeEach(() => {
  document.head.innerHTML = '';
  delete (window as unknown as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI;
});

afterEach(() => {
  document.head.innerHTML = '';
  delete (window as unknown as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI;
});

describe('loadExternalApi', () => {
  it('API già presente: onLoad subito, nessun tag', () => {
    defineApi();
    const onLoad = vi.fn();
    loadExternalApi(DOMAIN, { onLoad, onError: vi.fn() });
    expect(onLoad).toHaveBeenCalledOnce();
    expect(tags()).toHaveLength(0);
  });

  it('crea un tag verso il server della conferenza e chiama onLoad al caricamento', () => {
    const onLoad = vi.fn();
    loadExternalApi(DOMAIN, { onLoad, onError: vi.fn() });
    const [tag] = tags();
    expect(tag!.src).toBe(`https://${DOMAIN}/external_api.js`);
    defineApi();
    tag!.dispatchEvent(new Event('load'));
    expect(onLoad).toHaveBeenCalledOnce();
    expect(tag!.getAttribute(EXTERNAL_API_ATTR)).toBe('loaded');
  });

  it('un errore toglie il tag: il tentativo dopo ne crea uno nuovo', () => {
    const onError = vi.fn();
    loadExternalApi(DOMAIN, { onLoad: vi.fn(), onError });
    const [primo] = tags();
    primo!.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledOnce();
    expect(tags()).toHaveLength(0);

    const onLoad = vi.fn();
    loadExternalApi(DOMAIN, { onLoad, onError: vi.fn() });
    const [secondo] = tags();
    expect(secondo).toBeDefined();
    expect(secondo).not.toBe(primo);
    defineApi();
    secondo!.dispatchEvent(new Event('load'));
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('un tag nostro ancora in caricamento si riusa, ascoltando anche l’errore', () => {
    const detach = loadExternalApi(DOMAIN, { onLoad: vi.fn(), onError: vi.fn() });
    detach();
    const onError = vi.fn();
    loadExternalApi(DOMAIN, { onLoad: vi.fn(), onError });
    expect(tags()).toHaveLength(1);
    tags()[0]!.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('dopo lo smontaggio i gestori del componente non scattano più', () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    const detach = loadExternalApi(DOMAIN, { onLoad, onError });
    const [tag] = tags();
    detach();
    tag!.dispatchEvent(new Event('error'));
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    // …ma il tag fallito se ne va lo stesso.
    expect(tags()).toHaveLength(0);
  });

  it('uno script arrivato senza API (una pagina al posto del file) conta come errore', () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    loadExternalApi(DOMAIN, { onLoad, onError });
    tags()[0]!.dispatchEvent(new Event('load'));
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(tags()).toHaveLength(0);
  });

  it('i tag altrui non si aspettano: se ne crea uno proprio', () => {
    const altrui = document.createElement('script');
    altrui.src = `https://${DOMAIN}/external_api.js?prova=1`;
    document.head.appendChild(altrui);
    loadExternalApi(DOMAIN, { onLoad: vi.fn(), onError: vi.fn() });
    expect(tags()).toHaveLength(1);
    expect(tags()[0]).not.toBe(altrui);
  });
});

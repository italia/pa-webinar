// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copiaNegliAppunti } from './clipboard';

function conAppunti(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

describe('copiaNegliAppunti', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('riesce con gli appunti del browser', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    conAppunti(writeText);
    await expect(copiaNegliAppunti('https://esempio.it')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://esempio.it');
  });

  it("usa il ripiego e ne riporta l'esito vero", async () => {
    conAppunti(() => Promise.reject(new Error('negato')));
    document.execCommand = vi.fn().mockReturnValue(true);
    await expect(copiaNegliAppunti('x')).resolves.toBe(true);
  });

  it('non dice «copiato» se anche il ripiego fallisce', async () => {
    conAppunti(() => Promise.reject(new Error('negato')));
    document.execCommand = vi.fn().mockReturnValue(false);
    await expect(copiaNegliAppunti('x')).resolves.toBe(false);
    document.execCommand = vi.fn(() => {
      throw new Error('non supportato');
    });
    await expect(copiaNegliAppunti('x')).resolves.toBe(false);
    // la textarea d'appoggio non resta nel documento
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});

describe('copiaNegliAppunti — fuoco', () => {
  it('riporta il fuoco sul pulsante dopo il ripiego', async () => {
    conAppunti(() => Promise.reject(new Error('negato')));
    document.execCommand = vi.fn().mockReturnValue(true);
    const b = document.createElement('button');
    document.body.appendChild(b);
    b.focus();
    await copiaNegliAppunti('x');
    expect(document.activeElement).toBe(b);
    b.remove();
  });
});

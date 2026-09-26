// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { materialAddedBy, materialAuthorName } from './material-author';

describe('materialAddedBy — cosa si salva', () => {
  it('link principale con conduttore: il nome scritto sull’evento', () => {
    expect(materialAddedBy({ isPrimaryShared: true, displayName: ' Conduzione ' })).toBe(
      'Conduzione',
    );
  });

  it('link principale senza conduttore: nessun nome, mai una parola fissa', () => {
    expect(materialAddedBy({ isPrimaryShared: true, displayName: null })).toBe('');
  });

  it('co-moderatore: il suo nome cifrato non finisce in chiaro nella riga', () => {
    expect(materialAddedBy({ isPrimaryShared: false, displayName: 'Nome Cognome' })).toBe('');
  });

  it('nessun grant: nessun nome', () => {
    expect(materialAddedBy(null)).toBe('');
  });
});

describe('materialAuthorName — cosa si mostra', () => {
  it('un nome vero passa', () => {
    expect(materialAuthorName('Conduzione')).toBe('Conduzione');
  });

  it('vuoto o assente: null, e la sala usa la dicitura tradotta', () => {
    expect(materialAuthorName('')).toBeNull();
    expect(materialAuthorName('   ')).toBeNull();
    expect(materialAuthorName(null)).toBeNull();
    expect(materialAuthorName(undefined)).toBeNull();
  });

  it('i segnaposto scritti in passato non sono nomi', () => {
    expect(materialAuthorName('Moderator')).toBeNull();
    expect(materialAuthorName('moderator')).toBeNull();
    expect(materialAuthorName('Admin')).toBeNull();
  });
});

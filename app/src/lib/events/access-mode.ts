/**
 * Chi puo' iscriversi a un evento: la regola pura, senza banca dati, cosi' la
 * usano allo stesso modo il server (lib/events/registration-access) e il
 * wizard, che mostra la scelta in vigore.
 *
 * Ogni evento sceglie (`Event.accessMode`): `OPEN`, si iscrive chiunque;
 * `INVITATION`, solo gli invitati. Senza una scelta vale quella del sito
 * (`SiteSetting.publicRegistrationEnabled`).
 */

export type AccessModeValue = 'OPEN' | 'INVITATION';

/** L'iscrizione a questo evento e' aperta a chiunque? */
export function publicRegistrationFor(
  event: { accessMode: AccessModeValue | string | null },
  publicRegistrationEnabled: boolean,
): boolean {
  if (event.accessMode === 'OPEN') return true;
  if (event.accessMode === 'INVITATION') return false;
  return publicRegistrationEnabled;
}

/** La scelta da salvare per «chiunque si iscriva»: se coincide con quella del
 *  sito non si fissa, e l'evento continua a seguire il sito (se
 *  l'amministrazione chiude l'iscrizione, si chiude anche qui). «Solo chi
 *  inviti» si fissa sempre: promette anche che nessuno entra da ospite, cosa
 *  che il sito da solo non garantisce. */
export function accessModeDaSalvare(
  scelta: AccessModeValue,
  publicRegistrationEnabled: boolean,
): AccessModeValue | null {
  if (scelta === 'INVITATION') return 'INVITATION';
  return publicRegistrationEnabled ? null : 'OPEN';
}

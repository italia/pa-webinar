/**
 * Un indirizzo mailto: con oggetto e testo, che apre il programma di posta di
 * chi lo clicca. Il server non spedisce niente: e' per le email che chi
 * organizza manda di persona, una per destinatario.
 */
export function mailtoHref({ to, subject, body }: { to: string; subject: string; body: string }): string {
  // La chiocciola resta leggibile: i programmi di posta la accettano anche
  // codificata, ma non tutti.
  const destinatario = encodeURIComponent(to).replace(/%40/g, '@');
  return `mailto:${destinatario}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

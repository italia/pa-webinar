/**
 * La notifica di sistema della sala (chat e Domande e risposte). Parte solo
 * con il permesso gia' concesso: chiederlo spetta a un gesto di chi guarda
 * (la campanella della chat). Lo stesso `tag` raccoglie una raffica in una
 * notifica sola, e un clic riporta alla sala.
 */
export function showDesktopNotification(title: string, body: string, tag: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission !== 'granted') return;
    const n = new Notification(title, { body: body.slice(0, 140), tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Alcuni browser lanciano in contesti non sicuri o con le notifiche
    // bloccate dal sistema: l'avviso resta il suono e il pallino.
  }
}

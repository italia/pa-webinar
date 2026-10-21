'use client';

import { useState } from 'react';

/**
 * Una sezione del passo, richiudibile: chiusa finche' e' vuota, aperta se ha
 * gia' qualcuno. Il riassunto dice cosa contiene e quante persone ci sono,
 * cosi' il passo si legge con un colpo d'occhio e si apre solo cio' che serve.
 */
export default function Gruppo({
  title,
  help,
  count,
  aperto = false,
  children,
}: {
  title: string;
  help: string;
  count: number;
  /** Aperto anche se vuoto: serve compilarlo. */
  aperto?: boolean;
  children: React.ReactNode;
}) {
  const [apertoAllInizio] = useState(count > 0);
  return (
    <details className="wizard-group mb-3" open={apertoAllInizio || aperto || undefined}>
      <summary>
        <span className="wizard-group__title">
          {title}
          {count > 0 && (
            <span className="badge rounded-pill ms-2 wizard-group__count">{count}</span>
          )}
        </span>
        <span className="wizard-group__help">{help}</span>
      </summary>
      <div className="wizard-group__body">{children}</div>
    </details>
  );
}

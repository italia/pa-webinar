/**
 * Il resoconto come lo vede la pagina dell'evento: solo a evento concluso e
 * pubblicato dallo staff, nella lingua della pagina se c'e', altrimenti in
 * quella dell'evento.
 */
import { letturaResoconto } from './enqueue';
import type { ReportMetrics, ReportView } from './types';

/**
 * Nella pagina arrivano solo i numeri che la pagina mostra: l'indice di
 * attenzione e i tempi di permanenza restano all'amministrazione.
 */
function soloMostrati(m: ReportMetrics | null): ReportMetrics | null {
  if (!m) return null;
  return {
    ...m,
    attendance: { ...m.attendance, avgDwellSec: null, retentionPct: null },
    participation: { ...m.participation, attention: null },
  };
}

export function vistaResoconto(
  evento: { status: string; postEventReport: unknown; postEventReportPublished: boolean },
  lingua: string
): ReportView | null {
  if (evento.status !== 'ENDED' || !evento.postEventReportPublished) return null;
  const r = letturaResoconto(evento.postEventReport);
  if (!r) return null;
  const mostrata = r.narratives[lingua] ? lingua : r.sourceLanguage;
  const narrative = r.narratives[mostrata];
  if (!narrative) return null;
  return {
    metrics: soloMostrati(r.metrics),
    narrative,
    language: mostrata,
    sourceLanguage: r.sourceLanguage,
    requestedLanguage: lingua,
    generatedAt: r.generatedAt,
  };
}

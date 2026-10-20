/**
 * Le schede della pagina di una registrazione (components/admin/
 * recording-manage-client). A parte, senza `'use client'`: la pagina del
 * server le legge per aprire la scheda chiesta dall'indirizzo (`?tab=`).
 */

export type RecordingTab =
  | 'overview'
  | 'transcript'
  | 'summary'
  | 'translations'
  | 'slides'
  | 'archive'
  | 'reliability';

export const RECORDING_TABS: readonly RecordingTab[] = [
  'overview',
  'transcript',
  'summary',
  'translations',
  'slides',
  'archive',
  'reliability',
];

/** La scheda chiesta, se esiste; altrimenti la panoramica. */
export function recordingTabFrom(valore: string | undefined): RecordingTab {
  return RECORDING_TABS.find((k) => k === valore) ?? 'overview';
}

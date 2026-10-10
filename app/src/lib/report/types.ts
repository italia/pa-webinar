/**
 * Il resoconto dell'evento: i numeri, calcolati dal portale, e il testo,
 * scritto dal modello linguistico (worker della post-produzione, lavoro
 * REPORT). Si congela su Event.postEventReport.
 *
 * I numeri non passano mai dal modello: un modello linguistico li sbaglia. Il
 * testo li commenta, e la pagina li disegna.
 */

/** I numeri dell'evento, calcolati dal portale al momento della richiesta. */
export interface ReportMetrics {
  version: 1;
  durationSec: number;
  attendance: {
    registered: number;
    joined: number;
    peak: number;
    conversionPct: number | null;
    avgDwellSec: number | null;
    retentionPct: number | null;
  };
  participation: {
    interactions: number;
    activePeople: number;
    /** Persone attive su presenti, in percentuale. */
    activePct: number | null;
    chatMessages: number;
    questions: number;
    pollVotes: number;
    words: number;
    reactions: number;
    handRaises: number;
    /** Indice di attenzione 0-100 (lib/analytics/event-analytics). */
    attention: number | null;
  };
  timeline: {
    bucketSec: number;
    peakIndex: number;
    buckets: Array<{
      offsetSec: number;
      label: string;
      chat: number;
      questions: number;
      polls: number;
      words: number;
      reactions: number;
      total: number;
    }>;
  };
  agenda: Array<{
    label: string;
    status: string;
    plannedMinutes: number | null;
    actualMinutes: number | null;
    agree: number;
    disagree: number;
  }>;
  polls: Array<{
    question: string;
    options: Array<{ text: string; votes: number }>;
    totalVotes: number;
  }>;
  words: Array<{ word: string; count: number }>;
  questions: {
    total: number;
    answered: number;
    top: Array<{ text: string; upvotes: number }>;
  };
  feedback: {
    responses: number;
    average: number | null;
    items: Array<{
      prompt: string;
      average: number | null;
      scaleMin: number;
      scaleMax: number;
      distribution: number[];
      answered: number;
    }>;
  };
}

export type Stance = 'support' | 'concern' | 'question';
export type Agreement = 'high' | 'mixed' | 'low' | 'unknown';
export type ConceptKind = 'topic' | 'concept' | 'actor' | 'outcome';

/** Il testo del resoconto, in una lingua. */
export interface ReportNarrative {
  title: string;
  abstract: string;
  summary: string;
  highlights: string[];
  topics: Array<{
    title: string;
    explanation: string;
    keyPoints: string[];
    /** Minuto nella registrazione (MM:SS o H:MM:SS), se il tema si colloca. */
    start: string | null;
    agreement: Agreement;
    positions: Array<{ stance: Stance; text: string }>;
  }>;
  conceptMap: {
    nodes: Array<{ id: string; label: string; kind: ConceptKind }>;
    edges: Array<{ from: string; to: string; label: string }>;
  };
  consensus: { summary: string; agreements: string[]; disagreements: string[] };
  engagement: { summary: string; observations: string[] };
  benefits: { summary: string; items: string[] };
  feedback: {
    summary: string;
    strengths: string[];
    improvements: string[];
    quotes: string[];
  };
  openQuestions: string[];
  nextSteps: string[];
}

/** Quello che si congela su Event.postEventReport. */
export interface StoredReport {
  version: 1;
  generatedAt: string;
  sourceLanguage: string;
  model: { id: string | null; version: string | null };
  metrics: ReportMetrics | null;
  narratives: Record<string, ReportNarrative>;
}

/** Il resoconto come lo mostra la pagina dell'evento (lib/report/view). */
export interface ReportView {
  metrics: ReportMetrics | null;
  narrative: ReportNarrative;
  /** La lingua del testo mostrato. */
  language: string;
  /** La lingua dell'evento, in cui il resoconto e' stato scritto. */
  sourceLanguage: string;
  /** La lingua della pagina. */
  requestedLanguage: string;
  generatedAt: string;
}

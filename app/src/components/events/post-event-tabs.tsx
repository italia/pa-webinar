'use client';

import { useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Card,
  CardBody,
  Icon,
} from 'design-react-kit';

import TranscriptPanel from '@/components/events/transcript-panel';
import type { VideoPlayerHandle } from '@/components/events/video-player';

interface QuestionData {
  id: string;
  text: string;
  authorName: string;
  upvotes: number;
  status: string;
}

interface MaterialData {
  id: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  createdAt: string;
}

interface PollData {
  id: string;
  question: string;
  options: string[];
  voteCounts: number[];
  totalVotes: number;
}

interface FeedbackSummary {
  average: number | null;
  count: number;
  distribution: { rating: number; count: number }[];
}

interface PostEventTabsProps {
  questions: QuestionData[];
  materials: MaterialData[];
  polls: PollData[];
  feedback: FeedbackSummary | null;
  showQA: boolean;
  showMaterials: boolean;
  showPolls: boolean;
  showFeedback: boolean;
  /** Slug evento — usato per costruire l'endpoint trascrizione AI. */
  eventSlug?: string;
  /** Ref del VideoPlayer parent — usato dalla tab Trascrizione per
   *  click-to-seek sui segmenti. Quando assente, la tab Trascrizione
   *  non viene mostrata (graceful degradation: l'evento non ha pipeline
   *  AI abilitata). */
  playerRef?: RefObject<VideoPlayerHandle | null>;
  /** Lingua attiva (dal subtitle switcher del player), usata per
   *  scegliere la variante di summary da mostrare nel tab. */
  transcriptLanguage?: string | null;
  /** True quando il fetch postprod ha trovato almeno un artifact
   *  visibile (subtitle o audio). Se false la tab non appare. */
  transcriptAvailable?: boolean;
}

type TabKey = 'transcript' | 'qa' | 'materials' | 'polls' | 'feedback';

export default function PostEventTabs({
  questions,
  materials,
  polls,
  feedback,
  showQA,
  showMaterials,
  showPolls,
  showFeedback,
  eventSlug,
  playerRef,
  transcriptLanguage,
  transcriptAvailable,
}: PostEventTabsProps) {
  const t = useTranslations('postEvent.tabs');

  // Trascrizione visibile solo quando 3 condizioni si verificano insieme:
  //   1. `transcriptAvailable` true (la fetch postprod ha trovato
  //      almeno un sottotitolo o audio dubbed),
  //   2. abbiamo lo slug dell'evento per costruire l'endpoint,
  //   3. abbiamo un ref del player per il click-to-seek.
  // Mancanza di una qualsiasi → tab nascosta (graceful degradation:
  // l'evento può non aver attivato pipeline AI, oppure non c'è ancora
  // nessun artifact pronto).
  const transcriptShow =
    !!transcriptAvailable && !!eventSlug && !!playerRef;

  const tabs: { key: TabKey; label: string; count: number; show: boolean }[] = [
    { key: 'transcript', label: t('transcript'), count: 0, show: transcriptShow },
    { key: 'qa', label: t('qa'), count: questions.length, show: showQA && questions.length > 0 },
    { key: 'materials', label: t('materials'), count: materials.length, show: showMaterials && materials.length > 0 },
    { key: 'polls', label: t('polls'), count: polls.length, show: showPolls && polls.length > 0 },
    { key: 'feedback', label: t('feedback'), count: feedback?.count ?? 0, show: showFeedback && !!feedback && feedback.count > 0 },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  const [activeTab, setActiveTab] = useState<TabKey>(
    visibleTabs[0]?.key ?? 'qa',
  );

  if (visibleTabs.length === 0) return null;

  return (
    <div className="mt-4">
      {/* Tab navigation */}
      <div className="d-flex flex-wrap gap-2 mb-3">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn btn-sm d-inline-flex align-items-center gap-1 ${
              activeTab === tab.key
                ? 'btn-primary'
                : 'btn-outline-primary'
            }`}
            onClick={() => setActiveTab(tab.key)}
            style={{ borderRadius: 20 }}
          >
            {tab.label}
            {tab.count > 0 && (
              <Badge
                color=""
                pill
                style={{
                  fontSize: '0.68rem',
                  padding: '1px 6px',
                  backgroundColor: activeTab === tab.key ? 'rgba(255,255,255,0.25)' : 'rgba(0,102,204,0.1)',
                  color: activeTab === tab.key ? '#fff' : 'var(--app-primary)',
                }}
              >
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'transcript' && transcriptShow && eventSlug && playerRef && (
        <TranscriptPanel
          playerRef={playerRef}
          endpoint={`/api/events/${eventSlug}/postprod/transcript`}
          eventSlug={eventSlug}
          activeLanguage={transcriptLanguage ?? null}
        />
      )}
      {activeTab === 'qa' && showQA && (
        <QATabContent questions={questions} />
      )}
      {activeTab === 'materials' && showMaterials && (
        <MaterialsTabContent materials={materials} />
      )}
      {activeTab === 'polls' && showPolls && (
        <PollsTabContent polls={polls} />
      )}
      {activeTab === 'feedback' && showFeedback && feedback && (
        <FeedbackTabContent feedback={feedback} />
      )}
    </div>
  );
}

function QATabContent({ questions }: { questions: QuestionData[] }) {
  return (
    <div className="d-flex flex-column gap-2">
      {questions.map((q) => (
        <Card key={q.id} className="shadow-sm border-0" style={{ borderRadius: '0.5rem' }}>
          <CardBody className="p-3">
            <div className="d-flex justify-content-between align-items-start">
              <div style={{ minWidth: 0 }}>
                <p className="fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
                  {q.text}
                </p>
                <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                  {q.authorName}
                  {q.status === 'ANSWERED' && (
                    <Badge color="success" pill className="ms-2" style={{ fontSize: '0.68rem' }}>
                      Risposta data
                    </Badge>
                  )}
                </div>
              </div>
              <div className="d-flex align-items-center gap-1 flex-shrink-0 ms-2">
                <Icon icon="it-arrow-up" size="xs" className="text-primary" />
                <span className="fw-semibold" style={{ fontSize: '0.85rem', color: 'var(--app-primary)' }}>
                  {q.upvotes}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function MaterialsTabContent({ materials }: { materials: MaterialData[] }) {
  return (
    <div className="d-flex flex-column gap-2">
      {materials.map((m) => (
        <Card key={m.id} className="shadow-sm border-0" style={{ borderRadius: '0.5rem' }}>
          <CardBody className="p-3">
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="fw-semibold text-primary text-decoration-none d-inline-flex align-items-center gap-1"
            >
              <Icon icon="it-external-link" size="sm" />
              {m.title}
            </a>
            {m.description && (
              <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.88rem' }}>
                {m.description}
              </p>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function PollsTabContent({ polls }: { polls: PollData[] }) {
  return (
    <div className="d-flex flex-column gap-3">
      {polls.map((poll) => (
        <Card key={poll.id} className="shadow-sm border-0" style={{ borderRadius: '0.5rem' }}>
          <CardBody className="p-3">
            <p className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
              {poll.question}
            </p>
            <div className="d-flex flex-column gap-2">
              {poll.options.map((option, i) => {
                const count = poll.voteCounts[i] ?? 0;
                const pct = poll.totalVotes > 0 ? Math.round((count / poll.totalVotes) * 100) : 0;
                return (
                  <div key={i}>
                    <div className="d-flex justify-content-between mb-1" style={{ fontSize: '0.85rem' }}>
                      <span>{option}</span>
                      <span className="fw-semibold">{pct}%</span>
                    </div>
                    <div className="progress" style={{ height: 6, borderRadius: 3 }}>
                      <div
                        className="progress-bar bg-primary"
                        role="progressbar"
                        style={{ width: `${pct}%`, borderRadius: 3 }}
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-muted mt-2" style={{ fontSize: '0.78rem' }}>
              {poll.totalVotes} voti
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function FeedbackTabContent({ feedback }: { feedback: FeedbackSummary }) {
  const maxCount = Math.max(...feedback.distribution.map((d) => d.count), 1);

  return (
    <Card className="shadow-sm border-0" style={{ borderRadius: '0.5rem' }}>
      <CardBody className="p-3">
        {feedback.average !== null && (
          <div className="text-center mb-3">
            <div className="display-6 fw-bold" style={{ color: 'var(--app-text)' }}>
              {'⭐'.repeat(Math.round(feedback.average))}
            </div>
            <div className="fw-semibold" style={{ fontSize: '1.1rem', color: 'var(--app-text)' }}>
              {feedback.average.toFixed(1)}/5
            </div>
            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
              {feedback.count} valutazioni
            </div>
          </div>
        )}

        <div className="d-flex flex-column gap-1">
          {[5, 4, 3, 2, 1].map((rating) => {
            const item = feedback.distribution.find((d) => d.rating === rating);
            const count = item?.count ?? 0;
            const pct = feedback.count > 0 ? Math.round((count / feedback.count) * 100) : 0;
            const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
            return (
              <div key={rating} className="d-flex align-items-center gap-2" style={{ fontSize: '0.85rem' }}>
                <span style={{ width: 60, textAlign: 'right' }}>
                  {'⭐'.repeat(rating)}
                </span>
                <div className="flex-grow-1">
                  <div className="progress" style={{ height: 8, borderRadius: 4 }}>
                    <div
                      className="progress-bar"
                      style={{
                        width: `${barWidth}%`,
                        borderRadius: 4,
                        backgroundColor: '#FFB400',
                      }}
                    />
                  </div>
                </div>
                <span className="text-muted" style={{ width: 55, fontSize: '0.78rem' }}>
                  {pct}% ({count})
                </span>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

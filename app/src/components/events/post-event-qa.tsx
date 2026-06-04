'use client';

import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Icon } from 'design-react-kit';

interface Question {
  id: string;
  text: string;
  authorName: string;
  upvotes: number;
  status: string;
}

interface PostEventQAProps {
  questions: Question[];
}

const STATUS_COLOR: Record<string, string> = {
  ANSWERED: '#008758',
  HIGHLIGHTED: 'var(--app-primary)',
};

export default function PostEventQA({ questions }: PostEventQAProps) {
  const t = useTranslations('qa');

  if (questions.length === 0) {
    return (
      <p className="text-muted text-center py-3">
        {t('noAnsweredQuestions')}
      </p>
    );
  }

  return (
    <div className="d-flex flex-column gap-3">
      {questions.map((q) => (
        <Card
          key={q.id}
          className="border-0 shadow-sm"
          style={{ borderRadius: 8, borderLeft: `3px solid ${STATUS_COLOR[q.status] ?? '#5A768A'}` }}
        >
          <CardBody className="p-3">
            <div className="d-flex justify-content-between align-items-start mb-2">
              <span className="fw-semibold" style={{ fontSize: '0.85rem', color: 'var(--app-muted)' }}>
                {q.authorName}
              </span>
              <div className="d-flex align-items-center gap-2">
                <Badge
                  color=""
                  pill
                  className="px-2 py-1"
                  style={{
                    fontSize: '0.7rem',
                    backgroundColor: q.status === 'ANSWERED' ? '#D4EDDA' : '#E8F0FE',
                    color: STATUS_COLOR[q.status] ?? '#5A768A',
                  }}
                >
                  {t(`status.${q.status}` as 'status.ANSWERED' | 'status.HIGHLIGHTED')}
                </Badge>
                {q.upvotes > 0 && (
                  <span className="d-flex align-items-center text-muted" style={{ fontSize: '0.8rem' }}>
                    <Icon icon="it-arrow-up" size="xs" className="me-1" />
                    {q.upvotes}
                  </span>
                )}
              </div>
            </div>
            <p className="mb-0" style={{ color: 'var(--app-text)', lineHeight: 1.5 }}>
              {q.text}
            </p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

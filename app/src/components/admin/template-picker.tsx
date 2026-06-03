'use client';

import { useTranslations } from 'next-intl';
import { Card, CardBody, Icon, Badge } from 'design-react-kit';

interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
}

interface TemplatePickerProps {
  templates: TemplateSummary[];
  onSelect: (template: TemplateSummary) => void;
  onSkip: () => void;
}

export default function TemplatePicker({
  templates,
  onSelect,
  onSkip,
}: TemplatePickerProps) {
  const t = useTranslations('admin.templates');

  return (
    <div>
      <p className="text-secondary mb-4">{t('pickerSubtitle')}</p>

      <div className="row g-3 mb-4">
        {templates.map((tpl) => (
          <div key={tpl.id} className="col-12 col-sm-6 col-lg-3">
            <button
              type="button"
              className="border-0 bg-transparent p-0 w-100 text-start"
              onClick={() => onSelect(tpl)}
            >
              <Card
                className="h-100 border shadow-sm"
                style={{
                  borderRadius: 10,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.2s, transform 0.15s',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.boxShadow =
                    '0 4px 20px rgba(0,102,204,0.15)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.boxShadow = '';
                  e.currentTarget.style.transform = '';
                }}
              >
                <CardBody className="p-3 d-flex flex-column">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <div
                      className="d-flex align-items-center justify-content-center rounded-2"
                      style={{
                        width: 40,
                        height: 40,
                        backgroundColor: 'rgba(0,102,204,0.1)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon icon={tpl.icon} size="sm" color="primary" />
                    </div>
                    <h6
                      className="fw-semibold mb-0"
                      style={{ color: 'var(--app-text)', fontSize: '0.95rem' }}
                    >
                      {tpl.name}
                    </h6>
                  </div>
                  {tpl.description && (
                    <p
                      className="text-secondary mb-2 flex-grow-1"
                      style={{ fontSize: '0.8rem', lineHeight: 1.4 }}
                    >
                      {tpl.description}
                    </p>
                  )}
                  <div
                    className="d-flex flex-wrap gap-1"
                    style={{ fontSize: '0.7rem' }}
                  >
                    {tpl.qaEnabled && <Badge color="primary">Q&A</Badge>}
                    {tpl.chatEnabled && <Badge color="primary">Chat</Badge>}
                    {tpl.recordingEnabled && <Badge color="primary">Rec</Badge>}
                    {tpl.participantsCanUnmute && (
                      <Badge color="info">Mic</Badge>
                    )}
                    {tpl.participantsCanStartVideo && (
                      <Badge color="info">Video</Badge>
                    )}
                    {tpl.participantsCanShareScreen && (
                      <Badge color="info">Screen</Badge>
                    )}
                  </div>
                  <div
                    className="text-muted mt-2"
                    style={{ fontSize: '0.75rem' }}
                  >
                    Max {tpl.maxParticipants}
                  </div>
                </CardBody>
              </Card>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={onSkip}
      >
        {t('skipTemplate')}
      </button>
    </div>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardBody,
  FormGroup,
  Icon,
  Input,
} from 'design-react-kit';

interface PreJoinScreenProps {
  eventTitle: string;
  defaultName: string;
  onJoin: (displayName: string) => void;
}

export default function PreJoinScreen({
  eventTitle,
  defaultName,
  onJoin,
}: PreJoinScreenProps) {
  const t = useTranslations('live');
  const [name, setName] = useState(defaultName);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length >= 2) {
      onJoin(trimmed);
    }
  };

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-6 col-xl-5">
          <Card className="shadow-sm border-0" style={{ borderRadius: 12 }}>
            <CardBody className="p-4 p-md-5">
              <div className="text-center mb-4">
                <div
                  className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                  style={{
                    width: 56,
                    height: 56,
                    background: 'linear-gradient(135deg, #0066CC, #004080)',
                  }}
                >
                  <Icon icon="it-video" size="sm" color="white" />
                </div>
                <h1 className="h4 fw-bold mb-1" style={{ color: '#17324D' }}>
                  {eventTitle}
                </h1>
                <p className="text-muted mb-0">{t('preJoinSubtitle')}</p>
              </div>

              <form onSubmit={handleSubmit}>
                <FormGroup className="mb-4">
                  <Input
                    id="display-name"
                    label={t('preJoinNameLabel')}
                    type="text"
                    value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setName(e.target.value)
                    }
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </FormGroup>

                <Button
                  color="primary"
                  type="submit"
                  size="lg"
                  className="w-100 fw-semibold"
                  disabled={name.trim().length < 2}
                >
                  <Icon icon="it-video" size="sm" color="white" className="me-2" />
                  {t('enterRoom')}
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

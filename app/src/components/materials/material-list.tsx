import { Card, CardBody } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';

export interface PublicMaterial {
  id: string;
  title: string;
  url: string;
  description: string | null;
}

/**
 * L'elenco dei materiali come lo vede il pubblico nella scheda dell'evento:
 * prima dell'inizio e nella tab post-evento. Solo presentazione: quali
 * materiali entrano lo decide il server (lib/events/material-visibility).
 */
export default function MaterialList({ materials }: { materials: PublicMaterial[] }) {
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

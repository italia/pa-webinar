import { Card, CardBody } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface LegalDocumentSection {
  title: string;
  body: string;
}

interface LegalDocumentLink {
  href: string;
  label: string;
}

interface LegalDocumentPageProps {
  title: string;
  intro?: string;
  htmlContent?: string;
  sections?: LegalDocumentSection[];
  noteTitle?: string;
  noteBody?: string;
  noteLink?: LegalDocumentLink;
}

export default function LegalDocumentPage({
  title,
  intro,
  htmlContent,
  sections,
  noteTitle,
  noteBody,
  noteLink,
}: LegalDocumentPageProps) {
  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-9">
          <header className="mb-4">
            <h1 className="mb-3">{title}</h1>
            {intro && <p className="lead text-muted mb-0">{intro}</p>}
          </header>

          {htmlContent ? (
            <Card className="shadow-sm border-0">
              <CardBody className="p-4">
                <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
              </CardBody>
            </Card>
          ) : (
            <div className="d-flex flex-column gap-3">
              {sections?.map((section) => (
                <Card key={section.title} className="shadow-sm border-0">
                  <CardBody className="p-4">
                    <h2 className="h4 mb-3">{section.title}</h2>
                    <p className="mb-0">{section.body}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          {(noteTitle || noteBody || noteLink) && (
            <Card className="shadow-sm border-0 mt-3">
              <CardBody className="p-4">
                {noteTitle ? <h2 className="h4 mb-3">{noteTitle}</h2> : null}
                {noteBody ? <p className="mb-3">{noteBody}</p> : null}
                {noteLink ? (
                  <Link href={noteLink.href} className="btn btn-primary">
                    {noteLink.label}
                  </Link>
                ) : null}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

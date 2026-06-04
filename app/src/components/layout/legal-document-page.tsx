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

// Plain Bootstrap Italia card markup (not design-react-kit's <Card>): this is a
// Server Component, and design-react-kit's Card pulls in a React context that
// only works in Client Components, which throws under RSC.
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
            <div className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
              <div className="card-body p-4">
                <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
              </div>
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              {sections?.map((section) => (
                <div
                  key={section.title}
                  className="card shadow-sm border-0"
                  style={{ borderRadius: 8 }}
                >
                  <div className="card-body p-4">
                    <h2 className="h4 mb-3">{section.title}</h2>
                    <p className="mb-0">{section.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(noteTitle || noteBody || noteLink) && (
            <div
              className="card shadow-sm border-0 mt-3"
              style={{ borderRadius: 8 }}
            >
              <div className="card-body p-4">
                {noteTitle ? <h2 className="h4 mb-3">{noteTitle}</h2> : null}
                {noteBody ? <p className="mb-3">{noteBody}</p> : null}
                {noteLink ? (
                  <Link href={noteLink.href} className="btn btn-primary">
                    {noteLink.label}
                  </Link>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

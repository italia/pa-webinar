import Link from 'next/link';

export default function RootNotFound() {
  return (
    <html lang="it">
      <body>
        <main className="container py-5 text-center">
          <h1 className="display-1 fw-bold">404</h1>
          <p className="lead">Pagina non trovata / Page not found</p>
          <Link href="/it" className="btn btn-primary me-2">
            Torna alla home
          </Link>
          <Link href="/en" className="btn btn-outline-primary">
            Go to homepage
          </Link>
        </main>
      </body>
    </html>
  );
}

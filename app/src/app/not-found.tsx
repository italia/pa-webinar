import Link from 'next/link';

export default function RootNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="container py-5 text-center">
          <h1 className="display-1 fw-bold">404</h1>
          <p className="lead">Page not found / Pagina non trovata</p>
          <Link href="/en" className="btn btn-primary me-2">
            Homepage
          </Link>
          <Link href="/it" className="btn btn-outline-primary">
            Home
          </Link>
        </main>
      </body>
    </html>
  );
}

'use client';

import { Spinner } from 'design-react-kit';

export default function AdminLoading() {
  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center"
      style={{ minHeight: '60vh' }}
    >
      <Spinner active double />
      <p className="mt-3 text-muted">Caricamento...</p>
    </div>
  );
}

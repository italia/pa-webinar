'use client';

import { Spinner } from 'design-react-kit';

export default function LocaleLoading() {
  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center"
      style={{ minHeight: '60vh' }}
    >
      <Spinner active double aria-label="Loading" />
    </div>
  );
}

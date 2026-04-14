'use client';

import { useRef, useState } from 'react';
import { Icon } from 'design-react-kit';

interface VideoPlayerProps {
  src: string;
  title?: string;
}

export default function VideoPlayer({ src, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="d-flex align-items-center justify-content-center rounded" style={{ background: '#f5f7fb', height: 240 }}>
        <div className="text-center text-muted">
          <Icon icon="it-warning-circle" size="lg" className="mb-2" />
          <p className="small mb-0">Video non disponibile</p>
          <a href={src} target="_blank" rel="noopener noreferrer" className="small">
            Apri in una nuova scheda
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded overflow-hidden" style={{ background: '#000' }}>
      <video
        ref={videoRef}
        controls
        preload="metadata"
        style={{ width: '100%', maxHeight: 400, display: 'block' }}
        onError={() => setError(true)}
      >
        <source src={src} type="video/mp4" />
        {title && <track kind="captions" label={title} />}
      </video>
    </div>
  );
}

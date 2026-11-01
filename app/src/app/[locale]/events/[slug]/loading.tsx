'use client';

import { LiveRoomSkeleton } from '@/components/live/live-room-skeleton';
import { usePathname } from '@/i18n/navigation';

/**
 * Il segnaposto della pagina evento avvolge anche le sue sottopagine. Se il
 * server tarda a preparare la sala, compare questo e non quello della sala:
 * per la sala si mostra comunque la sua forma, altrimenti il piede della
 * pagina sale a meta' schermo e poi salta in fondo quando la sala arriva.
 */
export default function EventDetailLoading() {
  const pathname = usePathname();
  if (pathname === '/events/[slug]/live') return <LiveRoomSkeleton />;
  return (
    <div className="container py-5">
      <div className="bg-secondary bg-opacity-10 rounded mb-4" style={{ height: 14, width: 140 }} />

      <div className="row">
        <div className="col-lg-8 mb-4">
          <div className="bg-secondary bg-opacity-10 rounded mb-3" style={{ height: 24, width: 100 }} />
          <div className="bg-secondary bg-opacity-10 rounded mb-4" style={{ height: 36, width: '80%' }} />

          <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 16, width: '60%' }} />
          <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 16, width: '40%' }} />
          <div className="bg-secondary bg-opacity-10 rounded mb-4" style={{ height: 16, width: '50%' }} />

          <div className="bg-secondary bg-opacity-10 rounded mb-3" style={{ height: 24, width: 150 }} />
          <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 14, width: '100%' }} />
          <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 14, width: '95%' }} />
          <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 14, width: '90%' }} />
          <div className="bg-secondary bg-opacity-10 rounded" style={{ height: 14, width: '60%' }} />
        </div>

        <div className="col-lg-4">
          <div className="card card-bg shadow-sm">
            <div className="card-body">
              <div className="bg-secondary bg-opacity-10 rounded mb-3" style={{ height: 20, width: '60%' }} />
              <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 14, width: '80%' }} />
              <div className="bg-secondary bg-opacity-10 rounded mb-3" style={{ height: 14, width: '50%' }} />
              <div className="bg-secondary bg-opacity-10 rounded mb-4" style={{ height: 8, width: '100%' }} />
              <div className="bg-secondary bg-opacity-10 rounded" style={{ height: 44, width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

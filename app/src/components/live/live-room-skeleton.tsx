/**
 * Il segnaposto della sala mentre il server la prepara: la forma della sala
 * d'attesa e la sua altezza minima (.waiting-shell), cosi' il piede della
 * pagina resta sotto la piega e non salta quando la sala arriva (la piazza e
 * la conferenza sono alte almeno quanto lo schermo). Lo usano i due segnaposto che possono avvolgere la sala: il suo
 * (`live/loading`) e quello della pagina evento (`[slug]/loading`), perche'
 * quale dei due compare dipende da quanto ci mette il server.
 */
export function LiveRoomSkeleton() {
  return (
    <div className="waiting-shell" aria-busy="true">
      <div className="container py-4 py-md-5 wr-page">
        <div className="row g-4 justify-content-center">
          <div className="col-lg-7">
            <div className="it-card waiting-card wr-card shadow-sm border-0 border">
              <div className="p-4 p-md-5 card-body">
                <div
                  className="bg-secondary bg-opacity-10 rounded mb-3"
                  style={{ height: 22, width: 160 }}
                />
                <div
                  className="bg-secondary bg-opacity-10 rounded mb-4"
                  style={{ height: 36, width: '75%' }}
                />
                <div
                  className="bg-secondary bg-opacity-10 rounded mb-3"
                  style={{ height: 44, width: '100%' }}
                />
                <div
                  className="bg-secondary bg-opacity-10 rounded mb-4"
                  style={{ height: 96, width: '100%' }}
                />
                <div
                  className="bg-secondary bg-opacity-10 rounded"
                  style={{ height: 52, width: '100%' }}
                />
              </div>
            </div>
          </div>
          <div className="col-lg-5 d-none d-lg-block">
            <div
              className="bg-secondary bg-opacity-10 rounded mb-3"
              style={{ height: 14, width: 120 }}
            />
            <div
              className="bg-secondary bg-opacity-10 rounded"
              style={{ height: 128, width: '100%' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

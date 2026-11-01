/**
 * Il segnaposto della sala mentre il server la prepara: la stessa forma e la
 * stessa altezza minima della sala d'attesa (.waiting-shell), cosi' il piede
 * della pagina non compare a meta' schermo per poi saltare in fondo quando la
 * sala arriva (era lo spostamento piu' grande della pagina). Senza, valeva il
 * segnaposto della pagina evento, piu' corto e di un'altra forma.
 */
export default function LiveLoading() {
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

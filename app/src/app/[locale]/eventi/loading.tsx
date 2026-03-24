export default function EventiLoading() {
  return (
    <div className="container py-5">
      <div className="bg-secondary bg-opacity-10 rounded mb-4" style={{ height: 32, width: 200 }} />

      <div className="row g-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="col-12 col-md-6 col-lg-4">
            <div className="card card-bg shadow-sm h-100">
              <div className="card-body">
                <div className="bg-secondary bg-opacity-10 rounded mb-3" style={{ height: 20, width: '70%' }} />
                <div className="bg-secondary bg-opacity-10 rounded mb-2" style={{ height: 14, width: '50%' }} />
                <div className="bg-secondary bg-opacity-10 rounded mb-3" style={{ height: 14, width: '40%' }} />
                <div className="bg-secondary bg-opacity-10 rounded" style={{ height: 60, width: '100%' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

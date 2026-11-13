import "./Com_PageSke_Loader.scss"

// A community page while it loads: the header card, the KPI row and the grid,
// as striped placeholders in the same places (design 20c).
function Com_PageSke_Loader() {
  return (
    <div className="community-page-wrap com-skeleton" aria-hidden="true">
      <div className="v2-skeleton com-skeleton-hero" />
      <div className="com-skeleton-kpis">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="v2-skeleton com-skeleton-kpi" />)}
      </div>
      <div className="v2-skeleton com-skeleton-tabs" />
      <div className="com-skeleton-grid">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="com-skeleton-card">
            <div className="v2-skeleton com-skeleton-thumb" />
            <div className="v2-skeleton is-line" />
            <div className="v2-skeleton is-line com-skeleton-short" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default Com_PageSke_Loader

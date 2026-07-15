/**
 * Page-shape skeletons for the admin panel. Each function returns markup
 * that mirrors the real layout it stands in for — same wrappers, same
 * section grid, same KPI card count — so the perceived shift when data
 * lands is minimal. Colors and radii come from the shared token set (see
 * `Skeleton.css`), and every placeholder is a `<Skeleton>` under the hood.
 */
import { Skeleton } from './Skeleton';
import '../routes/DetailPage.css';
import '../routes/DashboardPage.css';

/** Six KPI tiles + two panels, matching DashboardPage's layout exactly. */
export function DashboardSkeleton() {
  return (
    <div className="rb-dashboard" aria-busy="true">
      <div className="rb-dashboard__head">
        <h1 className="rb-dashboard__title">Dashboard</h1>
        <Skeleton variant="text" width="14ch" />
      </div>

      <section className="rb-dashboard__kpis" aria-label="Kennzahlen">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rb-kpi">
            <Skeleton variant="text" width="12ch" />
            <Skeleton height="28px" width="6ch" radius="6px" />
            <Skeleton variant="text" width="9ch" />
          </div>
        ))}
      </section>

      <div className="rb-dashboard__grid">
        {Array.from({ length: 2 }, (_, i) => (
          <section key={i} className="rb-panel">
            <Skeleton variant="text" width="14ch" height="1.1em" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {Array.from({ length: 5 }, (_, r) => (
                <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Skeleton width="90px" height="20px" radius="999px" />
                  <Skeleton height="8px" style={{ flex: 1 }} radius="4px" />
                  <Skeleton variant="text" width="4ch" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Back arrow + title + N sections of field grids — used by user/ticket/delay. */
export function DetailPageSkeleton({ sections = 3 }: { sections?: number } = {}) {
  return (
    <div className="rb-detail" aria-busy="true">
      <Skeleton variant="text" width="8ch" />
      <h1 className="rb-detail__title" style={{ display: 'block' }}>
        <Skeleton height="1em" width="18ch" />
      </h1>
      {Array.from({ length: sections }, (_, s) => (
        <section key={s} className="rb-detail__section">
          <Skeleton variant="text" width="12ch" style={{ marginBottom: 12 }} />
          <div className="rb-detail__grid">
            {Array.from({ length: 4 }, (_, f) => (
              <div key={f} className="rb-detail__field">
                <Skeleton variant="text" width="10ch" />
                <Skeleton variant="text" width="16ch" height="1.1em" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

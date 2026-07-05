import { useSearchParams } from 'react-router-dom';
import { useAdminGoBack } from '../services/hooks/useAdminGoBack';
import '../admin.css';

/**
 * Stub for the delay drill-down (WP #478). Real implementation ships in a
 * later sprint; for now we render an informational placeholder so the link
 * from ticket detail resolves to a defined page instead of a 404.
 */
export function DelayDrilldownPage() {
  const goBack = useAdminGoBack('/admin-panel/tickets');
  const [params] = useSearchParams();
  const trainNr = params.get('trainNr');
  const datum = params.get('datum');

  return (
    <div className="rb-admin-shell">
      <button
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-deep-trust-blue)',
          cursor: 'pointer',
          fontSize: 'var(--font-size-body)',
          minHeight: 44,
          padding: '8px 0',
        }}
        onClick={goBack}
      >
        ← Zurück
      </button>
      <h1 className="rb-admin-shell__title">Verspätungen</h1>
      <p>
        Kommt in WP #478. Kontext:{' '}
        <strong>{trainNr ?? '—'}</strong> am <strong>{datum ?? '—'}</strong>.
      </p>
    </div>
  );
}

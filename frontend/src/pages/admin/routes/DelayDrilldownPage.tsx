import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAdminGoBack } from '../services/hooks/useAdminGoBack';
import { trainDelaysApi } from '../services/api/delays';
import { ApiError } from '../services/api/errors';
import type { TrainDelays } from '../services/types/delay';
import { fmtDate } from '../services/format/date';
import { Skeleton } from '../ui/Skeleton';
import '../admin.css';
import './DetailPage.css';
import './DelayDrilldownPage.css';

/**
 * Delay drill-down for a ticket's planned train. Reads
 * GET /admin/trains/{trainNr}/{date}/delays and renders one row per
 * segment. `trainNr` and `datum` come from the query string that
 * TicketDetailPage attaches when the admin follows the "Verspätungen
 * anzeigen" button; the `ticketId` param is kept for the back link and
 * page title only.
 *
 * Empty `segments` is a normal case, not an error (see BACKEND_CONTRACT.md
 * §Train delays), so we surface "Keine Verspätungsdaten vorhanden."
 * instead of the generic error state.
 */
export function DelayDrilldownPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [params] = useSearchParams();
  const goBack = useAdminGoBack(
    ticketId ? `/admin-panel/tickets/${encodeURIComponent(ticketId)}` : '/admin-panel/tickets',
  );
  const trainNr = params.get('trainNr');
  const datum = params.get('datum');

  const [data, setData] = useState<TrainDelays | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(trainNr && datum));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trainNr || !datum) {
      setLoading(false);
      setError('Zugnummer oder Datum fehlt in der URL.');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    trainDelaysApi
      .getTrainDelays(trainNr, datum, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setData(res);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError) {
          setError(err.status >= 500 ? 'Verspätungsdaten konnten nicht geladen werden.' : err.message);
        } else {
          setError('Verspätungsdaten konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [trainNr, datum]);

  return (
    <div className="rb-detail">
      <button className="rb-detail__back" onClick={() => goBack()}>
        ← Zurück
      </button>
      <h1 className="rb-detail__title">Verspätungen</h1>
      <p className="rb-delay__lede">
        Zug <strong>{trainNr ?? '—'}</strong> am{' '}
        <strong>{datum ? fmtDate(datum) : '—'}</strong>
      </p>

      {loading && (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height="44px" />
          ))}
        </div>
      )}
      {error && (
        <div className="rb-detail__error" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && data && data.segments.length === 0 && (
        <div className="rb-delay__empty">Keine Verspätungsdaten vorhanden.</div>
      )}
      {!loading && !error && data && data.segments.length > 0 && (
        <table className="rb-table rb-delay__table">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Ab (Plan / Ist)</th>
              <th>An (Plan / Ist)</th>
              <th>Verspätung</th>
              <th>Grund</th>
              <th>Quelle</th>
            </tr>
          </thead>
          <tbody>
            {data.segments.map((seg) => (
              <tr key={seg.segId} data-clickable="false">
                <td data-label="Segment">
                  <div>
                    <strong>{seg.origin}</strong> → <strong>{seg.destination}</strong>
                  </div>
                  {seg.is_cancelled && <div className="rb-delay__cancelled">Ausfall</div>}
                </td>
                <td data-label="Ab (Plan / Ist)">
                  {seg.abfahrtszeit_plan ?? '—'} / {seg.abfahrtszeit_tatsaechlich ?? '—'}
                </td>
                <td data-label="An (Plan / Ist)">
                  {seg.ankunftszeit_plan ?? '—'} / {seg.ankunftszeit_tatsaechlich ?? '—'}
                </td>
                <td data-label="Verspätung">
                  {seg.is_cancelled ? '—' : `${seg.delayMinutes} min`}
                </td>
                <td data-label="Grund">{seg.reason ?? '—'}</td>
                <td data-label="Quelle">
                  <span className={`rb-delay__source rb-delay__source--${seg.source}`}>
                    {seg.source}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

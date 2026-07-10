import { useEffect, useState } from 'react';
import { api, TicketSummary } from '../lib/api';

interface UseTicketsResult {
  tickets: TicketSummary[];
  loading: boolean;
  error: boolean;
}

/**
 * Lädt die Anträge des angemeldeten Nutzers über den get-tickets Endpoint.
 * `enabled` verhindert den Call, solange der Nutzer nicht eingeloggt ist
 * (z. B. auf der Landingpage für anonyme Besucher).
 */
export const useTickets = (enabled = true): UseTicketsResult => {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    api
      .getTickets()
      .then((res) => {
        if (!cancelled) setTickets(res.items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { tickets, loading, error };
};

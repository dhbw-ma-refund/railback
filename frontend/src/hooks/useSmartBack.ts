import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Liefert eine goBack-Funktion, die auf die zuletzt besuchte Seite zurückführt
 * (Browser-/Router-History). Gibt es keinen App-internen Verlauf — z. B. weil
 * die Seite direkt per Deep-Link, neuem Tab oder Reload geöffnet wurde —, wird
 * auf `fallback` navigiert, damit der Button nie aus der App hinausführt.
 *
 * `location.key === 'default'` markiert den ersten Router-Eintrag dieser
 * Session, also den Fall ohne Verlauf.
 */
export const useSmartBack = (fallback: string) => {
  const navigate = useNavigate();
  const location = useLocation();

  return () => {
    if (location.key !== 'default') {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };
};

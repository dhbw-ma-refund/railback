import { useNavigate } from 'react-router-dom';
import { readLastListUrl } from './useRememberListUrl';

/**
 * Returns a callback that prefers `navigate(-1)` (which restores browser
 * scroll and filter state) but falls back to the last remembered list URL
 * when history has no prior admin entry — typical on a fresh reload of a
 * detail page shared via link.
 */
export function useAdminGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    // history.length reflects the current tab; anything > 1 usually means we
    // have a real predecessor. On direct entry it's 1 and back would leave
    // the app.
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    const remembered = readLastListUrl();
    navigate(remembered ?? fallback, { replace: true });
  };
}

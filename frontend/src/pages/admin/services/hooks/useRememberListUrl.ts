import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';

const KEY = 'admin.list.lastUrl';

/**
 * Records the fully-qualified URL of a list route so that a detail view can
 * fall back to it if the user reloads (breaking browser history). Detail
 * views use readLastListUrl() when navigate(-1) would land them outside the
 * admin subtree.
 */
export function useRememberListUrl() {
  const location = useLocation();
  useEffect(() => {
    sessionStorage.setItem(KEY, location.pathname + location.search);
  }, [location]);
}

export function readLastListUrl(): string | null {
  return sessionStorage.getItem(KEY);
}

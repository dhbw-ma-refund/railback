/**
 * User-facing API client instance.
 *
 * Same transport as the admin panel (shared factory at
 * @shared/api/createClient), wired to the user-side localStorage-backed
 * token store and a /login redirect on failed refresh.
 */
import { createApiClient } from '@shared/api/createClient';
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from '../auth/storage';

export type { RequestOptions } from '@shared/api/createClient';

const created = createApiClient({
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  onRefreshFailed: () => {
    clearTokens();
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
  },
});

export const apiClient = created.apiClient;
export const request = created.request;
export const refreshAccessToken = created.refreshAccessToken;
export const setOnRefreshFailed = created.setOnRefreshFailed;

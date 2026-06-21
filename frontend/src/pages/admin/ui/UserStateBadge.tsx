import type { UserState } from '../services/types/user';
import { StatusBadge, type StatusType } from '../ui-library';

/**
 * Map the domain UserState enum to the library's three-tone StatusBadge
 * status so the palette stays consistent across list and detail views.
 */
const STATE_TO_STATUS: Record<UserState, StatusType> = {
  ACTIVE: 'approved',
  SUSPENDED: 'rejected',
  DELETION_SCHEDULED: 'pending',
};

const STATE_LABEL: Record<UserState, string> = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETION_SCHEDULED: 'DELETION_SCHEDULED',
};

export function UserStateBadge({ state }: { state: UserState }) {
  return <StatusBadge status={STATE_TO_STATUS[state]} label={STATE_LABEL[state]} />;
}

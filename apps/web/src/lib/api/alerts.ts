import { api } from './client';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertType =
  | 'BUDGET_EXHAUSTED'
  | 'HIGH_CPA'
  | 'LOW_ROAS'
  | 'DELIVERY_ISSUE'
  | 'OPTIMIZER_BLOCKED'
  | 'TOKEN_EXPIRY'
  | 'OPTIMIZER_ERROR'
  | 'LEARNING_STALLED';

export interface Alert {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  context: Record<string, unknown> | null;
  isRead: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const alertsApi = {
  list: (
    orgId: string,
    params?: { severity?: AlertSeverity; isRead?: boolean; entityId?: string; limit?: number },
  ) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : '';
    return api.get<Alert[]>(`/orgs/${orgId}/alerts${qs}`);
  },

  markRead: (orgId: string, alertId: string) =>
    api.patch(`/orgs/${orgId}/alerts/${alertId}/read`),

  markAllRead: (orgId: string) =>
    api.patch(`/orgs/${orgId}/alerts/read-all`),

  resolve: (orgId: string, alertId: string, note?: string) =>
    api.patch(`/orgs/${orgId}/alerts/${alertId}/resolve`, { note }),
};

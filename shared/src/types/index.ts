export type PlanTier = 'FREE' | 'PRO' | 'TEAM';
export type ProjectRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type HttpMethod = 'GET' | 'POST' | 'HEAD';
export type KeywordMatchType = 'CONTAINS' | 'NOT_CONTAINS';
export type MonitorStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'PAUSED' | 'PENDING';
export type CheckResultStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
export type CheckErrorType =
  | 'TIMEOUT'
  | 'DNS_ERROR'
  | 'CONNECTION_REFUSED'
  | 'TLS_ERROR'
  | 'SSRF_BLOCKED'
  | 'INVALID_STATUS'
  | 'KEYWORD_MISMATCH'
  | 'RESPONSE_TOO_LARGE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus = 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
export type IncidentTriggerReason = 'STATUS_DOWN' | 'HIGH_LATENCY' | 'KEYWORD_FAILURE' | 'TIMEOUT' | 'MANUAL';
export type IncidentEventType =
  | 'DETECTED'
  | 'ACKNOWLEDGED'
  | 'STATUS_CHANGED'
  | 'INVESTIGATION_NOTE'
  | 'ALERT_SENT'
  | 'RECOVERY_DETECTED'
  | 'RESOLVED';

export type AlertTriggerType =
  | 'MONITOR_DOWN'
  | 'MONITOR_RECOVERED'
  | 'HIGH_LATENCY'
  | 'INCIDENT_CREATED'
  | 'INCIDENT_RESOLVED';

export type AlertChannel = 'IN_APP' | 'EMAIL';
export type NotificationType =
  | 'MONITOR_DOWN'
  | 'MONITOR_RECOVERY'
  | 'HIGH_LATENCY'
  | 'INCIDENT_OPENED'
  | 'INCIDENT_ACKNOWLEDGED'
  | 'INCIDENT_RESOLVED';

export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';
export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface MonitorCheckJobPayload {
  monitorId: string;
  reason: 'scheduled' | 'manual' | 'initial';
}

export interface NotificationDispatchJobPayload {
  notificationIds: string[];
  projectId: string;
}

export type RealtimeEventPayload =
  | {
      type: 'monitor:checked';
      projectId: string;
      monitorId: string;
      status: MonitorStatus;
      responseTimeMs: number | null;
      statusCode: number | null;
      checkedAt: string;
    }
  | {
      type: 'monitor:status_changed';
      projectId: string;
      monitorId: string;
      previousStatus: MonitorStatus;
      currentStatus: MonitorStatus;
      checkedAt: string;
    }
  | {
      type: 'incident:created' | 'incident:updated' | 'incident:resolved';
      projectId: string;
      incidentId: string;
      monitorId: string;
      status: IncidentStatus;
      severity: IncidentSeverity;
      title: string;
      timestamp: string;
    }
  | {
      type: 'notification:new';
      userId: string;
      projectId: string;
      notificationId: string;
      title: string;
      body: string;
      notificationType: NotificationType;
      createdAt: string;
    };

export const QUEUE_NAMES = {
  MONITOR_CHECK: 'monitor-check',
  NOTIFICATION_DISPATCH: 'notification-dispatch',
  SYSTEM_MAINTENANCE: 'system-maintenance',
} as const;

export const REDIS_PUBSUB_CHANNEL = 'pulsewatch:events';

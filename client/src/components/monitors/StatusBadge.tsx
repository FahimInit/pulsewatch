import type { MonitorStatus, IncidentStatus } from '@pulsewatch/shared';
import { cn } from '@/lib/utils';

export function MonitorStatusDot({ status }: { status: MonitorStatus }) {
  const styles: Record<MonitorStatus, { text: string; label: string }> = {
    OPERATIONAL: { text: 'text-pw-green', label: 'Operational' },
    DEGRADED: { text: 'text-pw-orange', label: 'Degraded' },
    DOWN: { text: 'text-pw-red', label: 'Down' },
    PAUSED: { text: 'text-pw-muted', label: 'Paused' },
    PENDING: { text: 'text-pw-blue', label: 'Pending' },
  };
  const cfg = styles[status] || styles.PENDING;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10.5px] font-semibold', cfg.text)}>
      <span>●</span>
      <span>{cfg.label}</span>
    </span>
  );
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const map: Record<IncidentStatus, { cls: string; label: string }> = {
    INVESTIGATING: { cls: 'bg-pw-red-bg text-pw-red', label: 'Investigating' },
    IDENTIFIED: { cls: 'bg-pw-orange-bg text-pw-orange', label: 'Identified' },
    MONITORING: { cls: 'bg-pw-orange-bg text-pw-orange', label: 'Monitoring' },
    RESOLVED: { cls: 'bg-pw-green-bg text-pw-green', label: 'Resolved' },
  };
  const cfg = map[status] || map.INVESTIGATING;

  return (
    <span className={cn('inline-block rounded-[5px] px-[7px] py-[4px] text-[9.5px] font-semibold', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

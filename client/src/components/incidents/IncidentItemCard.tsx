import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { IncidentStatusBadge } from '@/components/monitors/StatusBadge';
import { cn, extractHostname, formatRelativeTime } from '@/lib/utils';

export interface IncidentSummaryItem {
  id: string;
  title: string;
  summary?: string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
  startedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  monitor: {
    id: string;
    name: string;
    url: string;
  };
}

export function IncidentItemCard({ incident }: { incident: IncidentSummaryItem }) {
  const isCriticalOrInv =
    incident.status === 'INVESTIGATING' || incident.severity === 'CRITICAL';

  return (
    <Link
      to={`/incidents/${incident.id}`}
      className="flex items-start gap-3 py-4 border-b border-pw-border hover:bg-[#fafbfe] rounded-md px-1 transition-colors"
    >
      <div
        className={cn(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] font-bold text-[12px]',
          incident.status === 'RESOLVED'
            ? 'bg-pw-green-bg text-pw-green'
            : isCriticalOrInv
              ? 'bg-pw-red-bg text-pw-red'
              : 'bg-pw-orange-bg text-pw-orange',
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <strong className="block text-[11.5px] font-semibold text-pw-text truncate">
          {incident.title}
        </strong>
        <small className="block text-[9.5px] text-pw-muted my-1 truncate">
          {extractHostname(incident.monitor.url)} · {formatRelativeTime(incident.startedAt)}
        </small>
        <IncidentStatusBadge status={incident.status} />
      </div>
    </Link>
  );
}

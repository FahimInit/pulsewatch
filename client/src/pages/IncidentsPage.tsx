import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/api/client';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { IncidentStatusBadge } from '@/components/monitors/StatusBadge';
import { extractHostname, formatDateTime, formatRelativeTime } from '@/lib/utils';

interface IncidentListRow {
  id: string;
  title: string;
  summary: string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  monitor: { id: string; name: string; url: string };
  acknowledgedBy?: { name: string } | null;
  _count?: { events: number };
}

export function IncidentsPage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'RESOLVED' | 'ALL'>('ACTIVE');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  const incidentsQuery = useQuery({
    queryKey: ['incidents', activeProject?.id, statusFilter, severityFilter],
    enabled: Boolean(activeProject?.id),
    queryFn: () => {
      const params = new URLSearchParams({ status: statusFilter });
      if (severityFilter !== 'ALL') params.set('severity', severityFilter);
      return apiFetch<{ incidents: IncidentListRow[] }>(
        `/projects/${activeProject!.id}/incidents?${params.toString()}`,
      );
    },
  });

  const ackMut = useMutation({
    mutationFn: (incidentId: string) =>
      apiFetch(`/projects/${activeProject!.id}/incidents/${incidentId}/acknowledge`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', activeProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  if (!activeProject) return null;
  const incidents = incidentsQuery.data?.incidents ?? [];
  const canMutate = activeProject.role !== 'VIEWER';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-7">
        <div>
          <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2">
            OUTAGE RESPONSE
          </p>
          <h1 className="text-[25px] font-bold tracking-[-1px] text-pw-text">Incidents</h1>
          <p className="text-[12px] text-pw-muted mt-1">
            Automated outage detection, acknowledgement, investigation timelines, and recovery logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(['ACTIVE', 'RESOLVED', 'ALL'] as const).map((tab) => (
            <Button
              key={tab}
              variant={statusFilter === tab ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setStatusFilter(tab)}
            >
              {tab === 'ACTIVE' ? 'Active' : tab === 'RESOLVED' ? 'Resolved' : 'All History'}
            </Button>
          ))}
        </div>
      </div>

      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">Incident Feed</h3>
            <p className="text-[10.5px] text-pw-muted">{incidents.length} incident(s) shown</p>
          </div>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="h-8 rounded-[7px] border border-pw-border bg-white px-2.5 text-[11px] font-semibold text-pw-subtle"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        {incidentsQuery.isLoading ? (
          <div className="py-12 text-center text-pw-muted">Loading incidents...</div>
        ) : incidents.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircle2 className="h-8 w-8 text-pw-green mx-auto mb-2" />
            <strong className="block text-[13px] text-pw-text">All clear</strong>
            <p className="text-[11.5px] text-pw-muted mt-1">
              No matching incidents found for this filter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left whitespace-nowrap">
              <thead>
                <tr className="bg-[#fafafd] text-[9px] font-semibold uppercase tracking-wider text-pw-muted">
                  <th className="py-3 px-3">Incident</th>
                  <th className="py-3 px-3">Service</th>
                  <th className="py-3 px-3">Severity</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Started</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f4] text-[11px]">
                {incidents.map((inc) => (
                  <tr
                    key={inc.id}
                    onClick={() => navigate(`/incidents/${inc.id}`)}
                    className="hover:bg-[#fafbfe] cursor-pointer transition-colors"
                  >
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-7 w-7 place-items-center rounded-[7px] bg-pw-red-bg text-pw-red shrink-0">
                          {inc.severity === 'CRITICAL' ? (
                            <ShieldAlert className="h-3.5 w-3.5" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <div>
                          <strong className="block text-[11.5px] font-semibold text-pw-text">
                            {inc.title}
                          </strong>
                          <small className="block text-[10px] text-pw-muted max-w-[320px] truncate">
                            {inc.summary || 'Automated threshold breach'}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="font-medium text-pw-text">{inc.monitor.name}</span>
                      <small className="block text-[9.5px] text-pw-muted">
                        {extractHostname(inc.monitor.url)}
                      </small>
                    </td>
                    <td className="py-3.5 px-3">
                      <Badge
                        variant={
                          inc.severity === 'CRITICAL'
                            ? 'down'
                            : inc.severity === 'HIGH'
                              ? 'degraded'
                              : 'pending'
                        }
                      >
                        {inc.severity}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-3">
                      <IncidentStatusBadge status={inc.status} />
                    </td>
                    <td className="py-3.5 px-3 text-pw-muted">
                      <div>{formatRelativeTime(inc.startedAt)}</div>
                      <small className="text-[9.5px]">{formatDateTime(inc.startedAt)}</small>
                    </td>
                    <td
                      className="py-3.5 px-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canMutate && inc.status !== 'RESOLVED' && !inc.acknowledgedAt ? (
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => ackMut.mutate(inc.id)}
                          disabled={ackMut.isPending}
                        >
                          Acknowledge
                        </Button>
                      ) : (
                        <span className="text-[10.5px] font-semibold text-pw-primary">
                          Timeline →
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

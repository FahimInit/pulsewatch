import { useState } from 'react';
import { useParams, useNavigate, useOutletContext, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  MessageSquarePlus,
  ShieldCheck,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '@/api/client';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea, Label } from '@/components/ui/input';
import { IncidentStatusBadge } from '@/components/monitors/StatusBadge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';

interface IncidentTimelineEvent {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
}

interface IncidentDetailData {
  id: string;
  title: string;
  summary: string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
  triggerReason: string;
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  monitor: { id: string; name: string; url: string; status: string };
  acknowledgedBy?: { name: string } | null;
  resolvedBy?: { name: string } | null;
  events: IncidentTimelineEvent[];
}

export function IncidentDetailPage() {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();

  const [noteText, setNoteText] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const incidentQuery = useQuery({
    queryKey: ['incident', activeProject?.id, incidentId],
    enabled: Boolean(activeProject?.id && incidentId),
    queryFn: () =>
      apiFetch<{ incident: IncidentDetailData }>(
        `/projects/${activeProject!.id}/incidents/${incidentId}`,
      ),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['incident', activeProject?.id, incidentId] });
    queryClient.invalidateQueries({ queryKey: ['incidents', activeProject?.id] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['analytics-overview', activeProject?.id] });
  };

  const ackMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}/incidents/${incidentId}/acknowledge`, {
        method: 'POST',
      }),
    onSuccess: refresh,
  });

  const statusMut = useMutation({
    mutationFn: (status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING') =>
      apiFetch(`/projects/${activeProject!.id}/incidents/${incidentId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
  });

  const addNoteMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}/incidents/${incidentId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ message: noteText.trim() }),
      }),
    onSuccess: () => {
      setNoteText('');
      refresh();
    },
  });

  const resolveMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}/incidents/${incidentId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolutionNotes: resolutionNotes.trim() }),
      }),
    onSuccess: () => {
      setResolveOpen(false);
      setResolutionNotes('');
      refresh();
    },
  });

  if (!activeProject) return null;
  if (incidentQuery.isLoading) {
    return <div className="py-12 text-center text-pw-muted">Loading incident timeline...</div>;
  }

  const incident = incidentQuery.data?.incident;
  if (!incident) {
    return (
      <div className="rounded-pw border border-pw-border bg-white p-8 text-center">
        <p className="text-pw-muted mb-3">Incident not found.</p>
        <Button variant="secondary" onClick={() => navigate('/incidents')}>
          Back to Incidents
        </Button>
      </div>
    );
  }

  const canMutate = activeProject.role !== 'VIEWER';
  const isResolved = incident.status === 'RESOLVED';

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate('/incidents')}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-pw-muted hover:text-pw-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Incidents
      </button>

      {/* Header */}
      <section className="rounded-pw border border-pw-border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <IncidentStatusBadge status={incident.status} />
              <Badge variant={incident.severity === 'CRITICAL' ? 'down' : 'degraded'}>
                {incident.severity}
              </Badge>
              <span className="text-[11px] text-pw-muted">
                Opened {formatRelativeTime(incident.startedAt)}
              </span>
            </div>
            <h1 className="text-[22px] font-bold tracking-tight text-pw-text">{incident.title}</h1>
            {incident.summary && (
              <p className="mt-1.5 text-[12px] text-pw-subtle">{incident.summary}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-pw-muted">
              <Link
                to={`/monitors/${incident.monitor.id}`}
                className="inline-flex items-center gap-1 font-semibold text-pw-primary hover:underline"
              >
                Monitor: {incident.monitor.name} <ExternalLink className="h-3 w-3" />
              </Link>
              <span>Started: {formatDateTime(incident.startedAt)}</span>
              {incident.acknowledgedAt && (
                <span>
                  Acknowledged by {incident.acknowledgedBy?.name || 'Engineer'} at{' '}
                  {formatDateTime(incident.acknowledgedAt)}
                </span>
              )}
              {incident.resolvedAt && (
                <span className="text-pw-green font-semibold">
                  Resolved at {formatDateTime(incident.resolvedAt)}
                </span>
              )}
            </div>
          </div>

          {canMutate && !isResolved && (
            <div className="flex flex-wrap items-center gap-2">
              {!incident.acknowledgedAt && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => ackMut.mutate()}
                  disabled={ackMut.isPending}
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-pw-primary" />
                  Acknowledge
                </Button>
              )}

              <select
                value={incident.status}
                onChange={(e) =>
                  statusMut.mutate(
                    e.target.value as 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING',
                  )
                }
                className="h-8 rounded-[8px] border border-pw-border bg-white px-2.5 text-[11px] font-semibold"
              >
                <option value="INVESTIGATING">Investigating</option>
                <option value="IDENTIFIED">Identified</option>
                <option value="MONITORING">Monitoring</option>
              </select>

              <Button size="sm" onClick={() => setResolveOpen(true)}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Resolve Incident
              </Button>
            </div>
          )}
        </div>

        {incident.resolutionNotes && (
          <div className="mt-4 rounded-[8px] border border-pw-green/25 bg-pw-green-bg px-4 py-3 text-[11.5px] text-pw-green">
            <strong>Resolution Summary:</strong> {incident.resolutionNotes}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chronological Incident Timeline */}
        <section className="lg:col-span-2 rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center gap-2 mb-5">
            <Clock className="h-4 w-4 text-pw-primary" />
            <h3 className="text-[14px] font-bold text-pw-text">Incident Timeline</h3>
          </div>

          <ol className="relative border-l-2 border-pw-border ml-3 space-y-5">
            {incident.events.map((ev) => (
              <li key={ev.id} className="ml-5">
                <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-pw-primary" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-pw-primary">
                    {ev.type.replace(/_/g, ' ')}
                  </span>
                  <time className="text-[10px] text-pw-muted">{formatDateTime(ev.createdAt)}</time>
                </div>
                <p className="mt-1 text-[12px] text-pw-text leading-relaxed whitespace-pre-wrap">
                  {ev.message}
                </p>
                <small className="mt-1 block text-[10px] text-pw-muted">
                  {ev.actor ? `${ev.actor.name} (${ev.actor.email})` : 'Pulsewatch Monitoring Worker'}
                </small>
              </li>
            ))}
          </ol>
        </section>

        {/* Investigation Note Composer */}
        <section className="rounded-pw border border-pw-border bg-white p-5 h-fit">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquarePlus className="h-4 w-4 text-pw-primary" />
            <h3 className="text-[14px] font-bold text-pw-text">Add Investigation Note</h3>
          </div>
          <p className="text-[11px] text-pw-muted mb-3">
            Log root-cause findings, mitigation commands, or postmortem notes to the permanent
            incident timeline.
          </p>

          {canMutate ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteText.trim()) return;
                addNoteMut.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <Label>Note</Label>
                <Textarea
                  placeholder="Upstream DB connection pool saturated; scaling replicas from 2 to 4..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={4}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={addNoteMut.isPending}>
                {addNoteMut.isPending ? 'Posting...' : 'Post to Timeline'}
              </Button>
            </form>
          ) : (
            <p className="text-[11px] text-pw-muted italic">
              Viewer role has read-only access to incident notes.
            </p>
          )}
        </section>
      </div>

      {/* Resolve Modal */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Incident</DialogTitle>
            <DialogDescription>
              Document how the issue was mitigated. This note is recorded in the incident history.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!resolutionNotes.trim()) return;
              resolveMut.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label>Resolution Notes</Label>
              <Textarea
                placeholder="Rolled back release v2.4.1 and verified 200 OK across all health endpoints."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResolveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={resolveMut.isPending}>
                {resolveMut.isPending ? 'Resolving...' : 'Confirm Resolution'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

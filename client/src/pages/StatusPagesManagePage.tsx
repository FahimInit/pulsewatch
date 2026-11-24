import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Plus,
  ExternalLink,
  Trash2,
  CalendarClock,
  AlertCircle,
} from 'lucide-react';
import { apiFetch, ApiClientError } from '@/api/client';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { MonitorRecord } from '@/components/monitors/MonitorFormDialog';
import { formatDateTime } from '@/lib/utils';

interface StatusPageRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  customHeadline: string | null;
  isPublic: boolean;
  showUptimeHistory: boolean;
  showIncidents: boolean;
  monitors: Array<{
    id: string;
    monitorId: string;
    displayName: string;
    groupName: string | null;
    monitor: { id: string; name: string; status: string };
  }>;
}

interface MaintenanceRecord {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  suppressAlerts: boolean;
  statusPage?: { name: string; slug: string } | null;
  monitors: Array<{ id: string; name: string }>;
}

export function StatusPagesManagePage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const queryClient = useQueryClient();

  const [pageDialogOpen, setPageDialogOpen] = useState(false);
  const [maintDialogOpen, setMaintDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status page form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [selectedMonitors, setSelectedMonitors] = useState<Record<string, string>>({});

  // Maintenance form state
  const [maintTitle, setMaintTitle] = useState('');
  const [maintDesc, setMaintDesc] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [suppressAlerts, setSuppressAlerts] = useState(true);
  const [maintMonitorIds, setMaintMonitorIds] = useState<string[]>([]);

  const pagesQuery = useQuery({
    queryKey: ['status-pages', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ statusPages: StatusPageRecord[] }>(
        `/projects/${activeProject!.id}/status-pages`,
      ),
  });

  const maintQuery = useQuery({
    queryKey: ['maintenance-windows', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ maintenanceWindows: MaintenanceRecord[] }>(
        `/projects/${activeProject!.id}/maintenance-windows`,
      ),
  });

  const monitorsQuery = useQuery({
    queryKey: ['monitors', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ monitors: MonitorRecord[] }>(`/projects/${activeProject!.id}/monitors`),
  });

  const createPageMut = useMutation({
    mutationFn: () => {
      const monitors = Object.entries(selectedMonitors).map(([monitorId, displayName], idx) => ({
        monitorId,
        displayName: displayName.trim() || 'Service',
        groupName: 'Core Services',
        sortOrder: idx,
      }));
      return apiFetch(`/projects/${activeProject!.id}/status-pages`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          description: description.trim() || null,
          isPublic,
          showUptimeHistory: true,
          showIncidents: true,
          monitors,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-pages', activeProject?.id] });
      setName('');
      setSlug('');
      setDescription('');
      setSelectedMonitors({});
      setError(null);
      setPageDialogOpen(false);
    },
    onError: (err: Error) => setError(err instanceof ApiClientError ? err.message : err.message),
  });

  const deletePageMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${activeProject!.id}/status-pages/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['status-pages', activeProject?.id] }),
  });

  const createMaintMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}/maintenance-windows`, {
        method: 'POST',
        body: JSON.stringify({
          title: maintTitle.trim(),
          description: maintDesc.trim() || null,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          suppressAlerts,
          monitorIds: maintMonitorIds,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-windows', activeProject?.id] });
      setMaintTitle('');
      setMaintDesc('');
      setMaintMonitorIds([]);
      setError(null);
      setMaintDialogOpen(false);
    },
    onError: (err: Error) => setError(err instanceof ApiClientError ? err.message : err.message),
  });

  const deleteMaintMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${activeProject!.id}/maintenance-windows/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['maintenance-windows', activeProject?.id] }),
  });

  if (!activeProject) return null;
  const canMutate = activeProject.role !== 'VIEWER';
  const pages = pagesQuery.data?.statusPages ?? [];
  const maintenances = maintQuery.data?.maintenanceWindows ?? [];
  const monitors = monitorsQuery.data?.monitors ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2">
            CUSTOMER TRANSPARENCY
          </p>
          <h1 className="text-[25px] font-bold tracking-[-1px] text-pw-text">
            Public Status Pages &amp; Maintenance
          </h1>
          <p className="text-[12px] text-pw-muted mt-1">
            Publish live service health, 90-day uptime bars, and scheduled maintenance notices.
          </p>
        </div>

        {canMutate && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setMaintDialogOpen(true);
              }}
            >
              <CalendarClock className="h-3.5 w-3.5" /> Schedule Maintenance
            </Button>
            <Button
              onClick={() => {
                setError(null);
                setPageDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Create Status Page
            </Button>
          </div>
        )}
      </div>

      {/* Status Pages List */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4 text-pw-primary" />
          <h3 className="text-[14px] font-bold text-pw-text">Published Status Pages</h3>
        </div>

        {pages.length === 0 ? (
          <div className="py-10 text-center text-pw-muted">
            No status pages published yet. Create one to share live service availability with users.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pages.map((p) => (
              <div
                key={p.id}
                className="rounded-[10px] border border-pw-border p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[14px] font-bold text-pw-text">{p.name}</h4>
                    <Badge variant={p.isPublic ? 'operational' : 'paused'}>
                      {p.isPublic ? 'Public' : 'Private'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-pw-muted mt-1">
                    {p.description || 'Live service status and incident history'}
                  </p>
                  <p className="text-[10.5px] text-pw-subtle mt-2">
                    <strong>{p.monitors.length}</strong> visible service(s) ·{' '}
                    <code className="text-pw-primary">/status/{p.slug}</code>
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-pw-border pt-3">
                  <Link
                    to={`/status/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pw-primary hover:underline"
                  >
                    Open Public Status Page <ExternalLink className="h-3.5 w-3.5" />
                  </Link>

                  {canMutate && (
                    <button
                      type="button"
                      onClick={() => deletePageMut.mutate(p.id)}
                      className="text-pw-muted hover:text-pw-red p-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Maintenance Windows */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="h-4 w-4 text-pw-primary" />
          <h3 className="text-[14px] font-bold text-pw-text">Maintenance Windows</h3>
        </div>

        {maintenances.length === 0 ? (
          <div className="py-8 text-center text-pw-muted">
            No scheduled maintenance windows configured.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left whitespace-nowrap">
              <thead>
                <tr className="bg-[#fafafd] text-[9px] font-semibold uppercase tracking-wider text-pw-muted">
                  <th className="py-2.5 px-3">Title</th>
                  <th className="py-2.5 px-3">Window</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Alert Suppression</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f4] text-[11px]">
                {maintenances.map((mw) => (
                  <tr key={mw.id}>
                    <td className="py-3 px-3 font-semibold text-pw-text">{mw.title}</td>
                    <td className="py-3 px-3 text-pw-muted">
                      {formatDateTime(mw.startsAt)} → {formatDateTime(mw.endsAt)}
                    </td>
                    <td className="py-3 px-3">
                      <Badge variant={mw.status === 'IN_PROGRESS' ? 'degraded' : 'purple'}>
                        {mw.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-pw-subtle">
                      {mw.suppressAlerts ? 'Alerts suppressed' : 'Alerts active'}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {canMutate && (
                        <button
                          type="button"
                          onClick={() => deleteMaintMut.mutate(mw.id)}
                          className="text-pw-red text-[10.5px] font-semibold hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create Status Page Modal */}
      <Dialog open={pageDialogOpen} onOpenChange={setPageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Public Status Page</DialogTitle>
            <DialogDescription>
              Choose a URL slug and select which monitors are publicly visible.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-[8px] bg-pw-red-bg px-3 py-2 text-[11px] text-pw-red">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createPageMut.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Page Title</Label>
                <Input
                  placeholder="Acme Platform Status"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug) {
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-|-$/g, ''),
                      );
                    }
                  }}
                  required
                />
              </div>
              <div>
                <Label>URL Slug</Label>
                <Input
                  placeholder="acme-status"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                placeholder="Real-time availability and incident updates for Acme APIs."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <Label>Visible Monitors</Label>
              <div className="max-h-44 overflow-y-auto rounded-[8px] border border-pw-border p-2.5 space-y-2">
                {monitors.length === 0 ? (
                  <p className="text-[11px] text-pw-muted">Create monitors first to attach them.</p>
                ) : (
                  monitors.map((m) => {
                    const checked = m.id in selectedMonitors;
                    return (
                      <label
                        key={m.id}
                        className="flex items-center justify-between gap-2 text-[11.5px] cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = { ...selectedMonitors };
                              if (e.target.checked) next[m.id] = m.name;
                              else delete next[m.id];
                              setSelectedMonitors(next);
                            }}
                            className="accent-pw-primary"
                          />
                          {m.name}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="accent-pw-primary"
              />
              Make status page publicly accessible
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setPageDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPageMut.isPending}>
                {createPageMut.isPending ? 'Publishing...' : 'Publish Status Page'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Schedule Maintenance Modal */}
      <Dialog open={maintDialogOpen} onOpenChange={setMaintDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Maintenance Window</DialogTitle>
            <DialogDescription>
              Announce planned maintenance and optionally suppress false-positive outage alerts.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="mb-3 rounded-[8px] bg-pw-red-bg px-3 py-2 text-[11px] text-pw-red">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMaintMut.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label>Maintenance Title</Label>
              <Input
                placeholder="PostgreSQL 16 Minor Version Upgrade"
                value={maintTitle}
                onChange={(e) => setMaintTitle(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Customer Notice</Label>
              <Textarea
                placeholder="Brief read-replica failover (~30s) expected during window."
                value={maintDesc}
                onChange={(e) => setMaintDesc(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Starts At</Label>
                <Input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Ends At</Label>
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label>Affected Monitors</Label>
              <div className="max-h-36 overflow-y-auto rounded-[8px] border border-pw-border p-2.5 space-y-1.5">
                {monitors.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-[11.5px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={maintMonitorIds.includes(m.id)}
                      onChange={(e) => {
                        if (e.target.checked) setMaintMonitorIds([...maintMonitorIds, m.id]);
                        else setMaintMonitorIds(maintMonitorIds.filter((id) => id !== m.id));
                      }}
                      className="accent-pw-primary"
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={suppressAlerts}
                onChange={(e) => setSuppressAlerts(e.target.checked)}
                className="accent-pw-primary"
              />
              Suppress incident creation &amp; alerts during window
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setMaintDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMaintMut.isPending}>
                Schedule Window
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { apiFetch } from '@/api/client';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { MonitorTable } from '@/components/monitors/MonitorTable';
import { MonitorFormDialog, type MonitorRecord } from '@/components/monitors/MonitorFormDialog';

export function MonitorsPage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<MonitorRecord | null>(null);

  const monitorsQuery = useQuery({
    queryKey: ['monitors', activeProject?.id, search, statusFilter],
    enabled: Boolean(activeProject?.id),
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      return apiFetch<{ monitors: MonitorRecord[] }>(
        `/projects/${activeProject!.id}/monitors?${params.toString()}`,
      );
    },
  });

  if (!activeProject) return null;
  const canMutate = activeProject.role !== 'VIEWER';
  const monitors = monitorsQuery.data?.monitors ?? [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7">
        <div>
          <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2">
            ENDPOINT HEALTH
          </p>
          <h1 className="text-[25px] font-bold tracking-[-1px] text-pw-text">Monitors</h1>
          <p className="text-[12px] text-pw-muted mt-1">
            Configure HTTP/HTTPS probes, response validations, and failure thresholds.
          </p>
        </div>

        {canMutate && (
          <Button
            onClick={() => {
              setEditingMonitor(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Monitor
          </Button>
        )}
      </div>

      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">Your Monitors</h3>
            <p className="text-[10.5px] text-pw-muted mt-0.5">
              {monitors.length} endpoint(s) · Quota {activeProject.monitorCount} /{' '}
              {activeProject.monitorLimit}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="h-3.5 w-3.5 text-pw-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                placeholder="Search monitors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full sm:w-[200px] rounded-[7px] border border-pw-border pl-8 pr-3 text-[11px] outline-none focus:border-pw-primary"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-[7px] border border-pw-border bg-white px-2.5 text-[11px] font-semibold text-pw-subtle"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPERATIONAL">Operational</option>
              <option value="DEGRADED">Degraded</option>
              <option value="DOWN">Down</option>
              <option value="PAUSED">Paused</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
        </div>

        {monitorsQuery.isLoading ? (
          <div className="py-12 text-center text-[12px] text-pw-muted">Loading monitors...</div>
        ) : (
          <MonitorTable
            projectId={activeProject.id}
            monitors={monitors}
            canMutate={canMutate}
            onEdit={(m) => {
              setEditingMonitor(m);
              setDialogOpen(true);
            }}
          />
        )}
      </section>

      <MonitorFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={activeProject.id}
        initialMonitor={editingMonitor}
      />
    </div>
  );
}

import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock,
  Radio,
  AlertTriangle,
  Plus,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '@/api/client';
import { useAuthStore } from '@/stores/auth-store';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/overview/MetricCard';
import {
  ResponseTimeChart,
  type LatencySeriesPoint,
} from '@/components/overview/ResponseTimeChart';
import {
  IncidentItemCard,
  type IncidentSummaryItem,
} from '@/components/incidents/IncidentItemCard';
import { MonitorTable } from '@/components/monitors/MonitorTable';
import {
  MonitorFormDialog,
  type MonitorRecord,
} from '@/components/monitors/MonitorFormDialog';
import { formatUptime } from '@/lib/utils';

interface OverviewAnalyticsPayload {
  range: string;
  overallUptime: number | null;
  uptimeDelta: number | null;
  avgResponseTimeMs: number | null;
  responseTimeDeltaPct: number | null;
  activeMonitors: number;
  totalMonitors: number;
  monitorLimit: number;
  activeIncidents: number;
  recentIncidents: IncidentSummaryItem[];
}

function getGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

export function OverviewPage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const user = useAuthStore((s) => s.user);

  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [addOpen, setAddOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<MonitorRecord | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['analytics-overview', activeProject?.id, range],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ overview: OverviewAnalyticsPayload }>(
        `/projects/${activeProject!.id}/analytics/overview?range=${range}`,
      ),
  });

  const latencyQuery = useQuery({
    queryKey: ['analytics-latency', activeProject?.id, range],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ series: LatencySeriesPoint[] }>(
        `/projects/${activeProject!.id}/analytics/response-times?range=${range}`,
      ),
  });

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
  const overview = overviewQuery.data?.overview;
  const monitors = monitorsQuery.data?.monitors ?? [];
  const firstName = user?.name?.split(' ')[0] || 'Developer';

  const availableSlots = Math.max(
    0,
    (overview?.monitorLimit ?? activeProject.monitorLimit) -
      (overview?.totalMonitors ?? activeProject.monitorCount),
  );

  const activeIncidentItems = (overview?.recentIncidents ?? []).filter(
    (inc) => inc.status !== 'RESOLVED',
  );

  return (
    <div>
      {/* Page Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7">
        <div>
          <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2.5">
            MONITORING OVERVIEW
          </p>
          <h1 className="text-[25px] font-bold tracking-[-1px] text-pw-text">
            {getGreeting()}, {firstName} 👋
          </h1>
          <p className="text-[12px] text-pw-muted mt-1">
            Here&apos;s what&apos;s happening with your services today.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as '24h' | '7d' | '30d')}
            className="flex-1 sm:flex-initial rounded-[8px] border border-pw-border bg-white px-3.5 py-[9px] text-[11.5px] font-semibold text-pw-subtle outline-none hover:bg-pw-bg cursor-pointer"
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>

          {canMutate && (
            <Button
              className="flex-1 sm:flex-initial"
              onClick={() => {
                setEditingMonitor(null);
                setAddOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add Monitor
            </Button>
          )}
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <MetricCard
          label="Overall Uptime"
          value={formatUptime(overview?.overallUptime)}
          icon={<Activity className="h-4 w-4" />}
          accent="purple"
          trendText={
            overview?.uptimeDelta !== null && overview?.uptimeDelta !== undefined
              ? `${overview.uptimeDelta >= 0 ? '↑' : '↓'} ${Math.abs(overview.uptimeDelta)}%`
              : 'Live SLA'
          }
          trendTone={
            overview?.uptimeDelta !== null &&
            overview?.uptimeDelta !== undefined &&
            overview.uptimeDelta < 0
              ? 'negative'
              : 'positive'
          }
          subtext="vs previous period"
        />

        <MetricCard
          label="Avg. Response Time"
          value={overview?.avgResponseTimeMs ?? '—'}
          unit={overview?.avgResponseTimeMs !== null && overview?.avgResponseTimeMs !== undefined ? 'ms' : undefined}
          icon={<Clock className="h-4 w-4" />}
          accent="blue"
          trendText={
            overview?.responseTimeDeltaPct !== null &&
            overview?.responseTimeDeltaPct !== undefined
              ? `${overview.responseTimeDeltaPct <= 0 ? '↓' : '↑'} ${Math.abs(overview.responseTimeDeltaPct)}%`
              : 'Measured HTTP RTT'
          }
          trendTone={
            overview?.responseTimeDeltaPct !== null &&
            overview?.responseTimeDeltaPct !== undefined &&
            overview.responseTimeDeltaPct > 0
              ? 'negative'
              : 'positive'
          }
          subtext="vs previous period"
        />

        <MetricCard
          label="Active Monitors"
          value={overview?.activeMonitors ?? activeProject.monitorCount}
          unit={`/ ${overview?.monitorLimit ?? activeProject.monitorLimit}`}
          icon={<Radio className="h-4 w-4" />}
          accent="green"
          trendText={`${availableSlots} available`}
          trendTone="neutral"
          subtext="monitor slots"
        />

        <MetricCard
          label="Active Incidents"
          value={String(overview?.activeIncidents ?? 0).padStart(2, '0')}
          icon={<AlertTriangle className="h-4 w-4" />}
          accent="red"
          trendText={
            (overview?.activeIncidents ?? 0) > 0
              ? `${overview?.activeIncidents} requiring attention`
              : '0 open outages'
          }
          trendTone={(overview?.activeIncidents ?? 0) > 0 ? 'negative' : 'positive'}
        />
      </div>

      {/* Content Grid: Response Time Chart + Active Incidents Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-[18px] mb-5">
        <ResponseTimeChart
          series={latencyQuery.data?.series ?? []}
          avgResponseTimeMs={overview?.avgResponseTimeMs ?? null}
          range={range}
          onRangeChange={setRange}
          isLoading={latencyQuery.isLoading}
        />

        <section className="rounded-pw border border-pw-border bg-white p-5 flex flex-col min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-bold text-pw-text">Active Incidents</h3>
              <p className="text-[10.5px] text-pw-muted mt-1">Issues that need your attention</p>
            </div>
            <Link to="/incidents" className="text-[10.5px] font-semibold text-pw-primary hover:underline">
              View all →
            </Link>
          </div>

          <div className="mt-2 flex-1">
            {activeIncidentItems.length === 0 ? (
              <div className="h-full min-h-[170px] flex flex-col items-center justify-center text-center px-4">
                <CheckCircle2 className="h-7 w-7 text-pw-green mb-2" />
                <strong className="text-[12px] text-pw-text">No active incidents</strong>
                <p className="text-[10.5px] text-pw-muted mt-1">
                  All monitored services are operating within configured thresholds.
                </p>
              </div>
            ) : (
              activeIncidentItems.slice(0, 3).map((incident) => (
                <IncidentItemCard key={incident.id} incident={incident} />
              ))
            )}
          </div>

          <div className="mt-auto pt-3.5 flex items-center justify-between text-[10.5px] text-pw-muted border-t border-pw-border/60">
            <span>{overview?.activeIncidents ?? 0} active incidents</span>
            <Link to="/incidents" className="font-semibold text-pw-primary hover:underline">
              Manage incidents →
            </Link>
          </div>
        </section>
      </div>

      {/* Monitors Table Panel */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">Your Monitors</h3>
            <p className="text-[10.5px] text-pw-muted mt-1">Overview of your monitored services</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="h-3.5 w-3.5 text-pw-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                placeholder="Search monitors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full sm:w-[175px] rounded-[7px] border border-pw-border pl-8 pr-2.5 text-[10.5px] outline-none focus:border-pw-primary"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-[8px] border border-pw-border bg-white px-2.5 text-[11px] font-semibold text-pw-subtle"
            >
              <option value="ALL">Filter: All</option>
              <option value="OPERATIONAL">Operational</option>
              <option value="DEGRADED">Degraded</option>
              <option value="DOWN">Down</option>
              <option value="PAUSED">Paused</option>
            </select>

            {canMutate && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingMonitor(null);
                  setAddOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add Monitor
              </Button>
            )}
          </div>
        </div>

        <MonitorTable
          projectId={activeProject.id}
          monitors={monitors.slice(0, 8)}
          canMutate={canMutate}
          onEdit={(m) => {
            setEditingMonitor(m);
            setAddOpen(true);
          }}
        />

        <div className="pt-4 flex items-center justify-between text-[10.5px] text-pw-muted">
          <span>
            Showing {Math.min(8, monitors.length)} of {monitors.length} monitors
          </span>
          <Link to="/monitors" className="font-semibold text-pw-primary hover:underline">
            View all monitors →
          </Link>
        </div>
      </section>

      <MonitorFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={activeProject.id}
        initialMonitor={editingMonitor}
      />
    </div>
  );
}

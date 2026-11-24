import { useState } from 'react';
import { useParams, useNavigate, useOutletContext, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  RefreshCw,
  Pause,
  Play,
  Pencil,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { format } from 'date-fns';
import { apiFetch } from '@/api/client';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { MonitorStatusDot } from '@/components/monitors/StatusBadge';
import { MonitorFormDialog, type MonitorRecord } from '@/components/monitors/MonitorFormDialog';
import { formatDateTime, formatRelativeTime, formatUptime } from '@/lib/utils';

interface CheckResultItem {
  id: string;
  checkedAt: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
  statusCode: number | null;
  responseTimeMs: number | null;
  dnsTimeMs: number | null;
  connectTimeMs: number | null;
  ttfbMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  resolvedIp: string | null;
}

export function MonitorDetailPage() {
  const { monitorId } = useParams<{ monitorId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [editOpen, setEditOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['monitor', activeProject?.id, monitorId],
    enabled: Boolean(activeProject?.id && monitorId),
    queryFn: () =>
      apiFetch<{
        monitor: MonitorRecord & {
          avgResponseTime30d: number | null;
          activeIncident?: { id: string; title: string; status: string } | null;
        };
      }>(`/projects/${activeProject!.id}/monitors/${monitorId}`),
  });

  const resultsQuery = useQuery({
    queryKey: ['monitor-results', activeProject?.id, monitorId, range],
    enabled: Boolean(activeProject?.id && monitorId),
    queryFn: () =>
      apiFetch<{ results: CheckResultItem[] }>(
        `/projects/${activeProject!.id}/monitors/${monitorId}/results?range=${range}&limit=100`,
      ),
  });

  const checkNowMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}/monitors/${monitorId}/check-now`, {
        method: 'POST',
      }),
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['monitor', activeProject?.id, monitorId] });
        queryClient.invalidateQueries({
          queryKey: ['monitor-results', activeProject?.id, monitorId],
        });
      }, 800);
    },
  });

  const pauseResumeMut = useMutation({
    mutationFn: (action: 'pause' | 'resume') =>
      apiFetch(`/projects/${activeProject!.id}/monitors/${monitorId}/${action}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor', activeProject?.id, monitorId] });
      queryClient.invalidateQueries({ queryKey: ['monitors', activeProject?.id] });
    },
  });

  if (!activeProject) return null;
  if (detailQuery.isLoading) {
    return <div className="py-12 text-center text-pw-muted">Loading monitor telemetry...</div>;
  }

  const monitor = detailQuery.data?.monitor;
  if (!monitor) {
    return (
      <div className="rounded-pw border border-pw-border bg-white p-8 text-center">
        <p className="text-pw-muted mb-3">Monitor not found in this workspace.</p>
        <Button variant="secondary" onClick={() => navigate('/monitors')}>
          Back to Monitors
        </Button>
      </div>
    );
  }

  const canMutate = activeProject.role !== 'VIEWER';
  const results = resultsQuery.data?.results ?? [];
  const chartData = [...results]
    .reverse()
    .filter((r) => r.responseTimeMs !== null)
    .map((r) => ({
      time: format(new Date(r.checkedAt), range === '24h' ? 'HH:mm' : 'MMM d HH:mm'),
      ms: r.responseTimeMs,
    }));

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate('/monitors')}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-pw-muted hover:text-pw-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Monitors
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-bold tracking-[-0.8px] text-pw-text">{monitor.name}</h1>
            <MonitorStatusDot status={monitor.status} />
          </div>
          <p className="mt-1 text-[12px] text-pw-muted font-mono break-all">
            {monitor.method} {monitor.url}
          </p>
        </div>

        {canMutate && (
          <div className="flex flex-wrap items-center gap-2">
            {monitor.status !== 'PAUSED' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => checkNowMut.mutate()}
                disabled={checkNowMut.isPending}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {checkNowMut.isPending ? 'Queued...' : 'Check Now'}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                pauseResumeMut.mutate(monitor.status === 'PAUSED' ? 'resume' : 'pause')
              }
            >
              {monitor.status === 'PAUSED' ? (
                <>
                  <Play className="h-3.5 w-3.5" /> Resume
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </>
              )}
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        )}
      </div>

      {monitor.activeIncident && (
        <div className="flex items-center justify-between gap-4 rounded-pw border border-pw-red/30 bg-pw-red-bg px-4 py-3 text-[12px] text-pw-red">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>Active Incident:</strong> {monitor.activeIncident.title} (
              {monitor.activeIncident.status})
            </span>
          </div>
          <Link
            to={`/incidents/${monitor.activeIncident.id}`}
            className="font-bold underline shrink-0"
          >
            Open incident →
          </Link>
        </div>
      )}

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center justify-between text-[11px] text-pw-muted">
            <span>Uptime (24h)</span>
            <CheckCircle2 className="h-4 w-4 text-pw-green" />
          </div>
          <h2 className="text-[26px] font-bold tracking-tight mt-3">
            {formatUptime(monitor.uptime24h)}
          </h2>
          <p className="text-[10px] text-pw-muted mt-1">
            30-day: {formatUptime(monitor.uptime30d)}
          </p>
        </div>

        <div className="rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center justify-between text-[11px] text-pw-muted">
            <span>Latest Response</span>
            <Clock className="h-4 w-4 text-pw-blue" />
          </div>
          <h2 className="text-[26px] font-bold tracking-tight mt-3">
            {monitor.lastResponseTimeMs ?? '—'}{' '}
            <small className="text-[12px] font-normal text-pw-muted">ms</small>
          </h2>
          <p className="text-[10px] text-pw-muted mt-1">
            24h avg: {monitor.avgResponseTime24h ? `${monitor.avgResponseTime24h} ms` : '—'}
          </p>
        </div>

        <div className="rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center justify-between text-[11px] text-pw-muted">
            <span>Check Interval</span>
            <Activity className="h-4 w-4 text-pw-primary" />
          </div>
          <h2 className="text-[26px] font-bold tracking-tight mt-3">
            {monitor.intervalSeconds}
            <small className="text-[12px] font-normal text-pw-muted">s</small>
          </h2>
          <p className="text-[10px] text-pw-muted mt-1">
            Timeout {monitor.timeoutMs}ms · Degraded &gt;{monitor.degradedThresholdMs}ms
          </p>
        </div>

        <div className="rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center justify-between text-[11px] text-pw-muted">
            <span>Last Checked</span>
            <RefreshCw className="h-4 w-4 text-pw-muted" />
          </div>
          <h2 className="text-[18px] font-bold tracking-tight mt-4">
            {formatRelativeTime(monitor.lastCheckedAt)}
          </h2>
          <p className="text-[10px] text-pw-muted mt-1">
            Expected HTTP: {monitor.expectedStatusCodes.join(', ')}
          </p>
        </div>
      </div>

      {/* Response Time Chart */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">Response Time History</h3>
            <p className="text-[10.5px] text-pw-muted">Measured round-trip HTTP check latency</p>
          </div>
          <div className="flex gap-1.5">
            {(['24h', '7d', '30d'] as const).map((r) => (
              <Button
                key={r}
                variant={range === r ? 'primary' : 'secondary'}
                size="xs"
                onClick={() => setRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="h-[220px] grid place-items-center text-[11.5px] text-pw-muted">
            Waiting for initial check telemetry...
          </div>
        ) : (
          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="monitorLatencyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7657e8" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#7657e8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ebebf1" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9295a8' }} tickLine={false} />
                <YAxis
                  unit="ms"
                  tick={{ fontSize: 10, fill: '#9295a8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #e9eaf0',
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="ms"
                  name="Response time (ms)"
                  stroke="#7657e8"
                  strokeWidth={2.5}
                  fill="url(#monitorLatencyFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Check Execution History Table */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <h3 className="text-[14px] font-bold text-pw-text">Recent Check Executions</h3>
        <p className="text-[10.5px] text-pw-muted mt-0.5">
          Granular timing breakdown and HTTP status assertions
        </p>

        <div className="overflow-x-auto mt-4">
          <table className="w-full border-collapse text-left whitespace-nowrap">
            <thead>
              <tr className="bg-[#fafafd] text-[9px] font-semibold uppercase tracking-wider text-pw-muted">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Outcome</th>
                <th className="py-2.5 px-3">HTTP Code</th>
                <th className="py-2.5 px-3">Total Latency</th>
                <th className="py-2.5 px-3">DNS / TCP / TTFB</th>
                <th className="py-2.5 px-3">Resolved IP</th>
                <th className="py-2.5 px-3">Diagnostic</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f4] text-[10.5px]">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-pw-muted">
                    No check executions recorded yet.
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 px-3 text-pw-text">{formatDateTime(r.checkedAt)}</td>
                    <td className="py-3 px-3">
                      <MonitorStatusDot status={r.status} />
                    </td>
                    <td className="py-3 px-3 font-mono">{r.statusCode ?? '—'}</td>
                    <td className="py-3 px-3 font-semibold text-pw-text">
                      {r.responseTimeMs !== null ? `${r.responseTimeMs} ms` : '—'}
                    </td>
                    <td className="py-3 px-3 text-pw-muted font-mono text-[10px]">
                      {r.dnsTimeMs ?? 0}ms / {r.connectTimeMs ?? 0}ms / {r.ttfbMs ?? 0}ms
                    </td>
                    <td className="py-3 px-3 font-mono text-pw-muted">{r.resolvedIp || '—'}</td>
                    <td className="py-3 px-3 text-pw-red max-w-[260px] truncate">
                      {r.errorMessage || <span className="text-pw-green">OK</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <MonitorFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={activeProject.id}
        initialMonitor={monitor}
      />
    </div>
  );
}

import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { format } from 'date-fns';
import { apiFetch } from '@/api/client';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import type { MonitorRecord } from '@/components/monitors/MonitorFormDialog';
import type { LatencySeriesPoint } from '@/components/overview/ResponseTimeChart';

interface UptimeSeriesPoint {
  date: string;
  uptimePct: number;
  totalChecks: number;
  downChecks: number;
  avgLatencyMs: number | null;
}

interface HealthDistItem {
  status: string;
  count: number;
}

export function AnalyticsPage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [uptimeRange, setUptimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedMonitorId, setSelectedMonitorId] = useState<string>('');

  const monitorsQuery = useQuery({
    queryKey: ['monitors', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ monitors: MonitorRecord[] }>(`/projects/${activeProject!.id}/monitors`),
  });

  const latencyQuery = useQuery({
    queryKey: ['analytics-latency', activeProject?.id, range, selectedMonitorId],
    enabled: Boolean(activeProject?.id),
    queryFn: () => {
      const params = new URLSearchParams({ range });
      if (selectedMonitorId) params.set('monitorId', selectedMonitorId);
      return apiFetch<{ series: LatencySeriesPoint[] }>(
        `/projects/${activeProject!.id}/analytics/response-times?${params.toString()}`,
      );
    },
  });

  const uptimeQuery = useQuery({
    queryKey: ['analytics-uptime', activeProject?.id, uptimeRange, selectedMonitorId],
    enabled: Boolean(activeProject?.id),
    queryFn: () => {
      const params = new URLSearchParams({ range: uptimeRange });
      if (selectedMonitorId) params.set('monitorId', selectedMonitorId);
      return apiFetch<{ series: UptimeSeriesPoint[] }>(
        `/projects/${activeProject!.id}/analytics/uptime?${params.toString()}`,
      );
    },
  });

  const healthQuery = useQuery({
    queryKey: ['analytics-health', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ distribution: HealthDistItem[] }>(
        `/projects/${activeProject!.id}/analytics/health-distribution`,
      ),
  });

  if (!activeProject) return null;

  const latencyData = (latencyQuery.data?.series ?? []).map((p) => ({
    ...p,
    label: format(new Date(p.timestamp), range === '24h' ? 'HH:mm' : 'MMM d HH:mm'),
  }));

  const uptimeData = uptimeQuery.data?.series ?? [];
  const distribution = healthQuery.data?.distribution ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2">
            SLA &amp; TELEMETRY
          </p>
          <h1 className="text-[25px] font-bold tracking-[-1px] text-pw-text">
            Historical Analytics
          </h1>
          <p className="text-[12px] text-pw-muted mt-1">
            Analyze P95 latency percentiles, daily availability rollups, and fleet health
            distribution.
          </p>
        </div>

        <select
          value={selectedMonitorId}
          onChange={(e) => setSelectedMonitorId(e.target.value)}
          className="h-9 rounded-[8px] border border-pw-border bg-white px-3 text-[11.5px] font-semibold text-pw-text"
        >
          <option value="">All Monitors in {activeProject.name}</option>
          {(monitorsQuery.data?.monitors ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Fleet Health Distribution Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {distribution.map((item) => (
          <div key={item.status} className="rounded-pw border border-pw-border bg-white p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-pw-muted">
              {item.status}
            </span>
            <div className="mt-2 text-[24px] font-bold text-pw-text">{item.count}</div>
          </div>
        ))}
      </div>

      {/* Avg vs P95 Response Time Chart */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">
              Average vs P95 Response Time (ms)
            </h3>
            <p className="text-[10.5px] text-pw-muted">
              Computed directly from PostgreSQL time-bucketed check measurements
            </p>
          </div>
          <div className="flex gap-1.5">
            {(['24h', '7d', '30d'] as const).map((r) => (
              <Button
                key={r}
                size="xs"
                variant={range === r ? 'primary' : 'secondary'}
                onClick={() => setRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>

        <div className="h-[260px] w-full">
          {latencyData.length === 0 ? (
            <div className="h-full grid place-items-center text-[11.5px] text-pw-muted">
              No latency measurements recorded in this window yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ebebf1" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9295a8' }} />
                <YAxis unit="ms" tick={{ fontSize: 10, fill: '#9295a8' }} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="avgMs"
                  name="Average (ms)"
                  stroke="#7657e8"
                  fill="#7657e8"
                  fillOpacity={0.16}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="p95Ms"
                  name="P95 Tail Latency (ms)"
                  stroke="#e69b40"
                  fill="#e69b40"
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Daily Uptime SLA Bar Chart */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">Daily Uptime SLA (%)</h3>
            <p className="text-[10.5px] text-pw-muted">
              Aggregated from daily monitor rollups
            </p>
          </div>
          <div className="flex gap-1.5">
            {(['7d', '30d', '90d'] as const).map((r) => (
              <Button
                key={r}
                size="xs"
                variant={uptimeRange === r ? 'primary' : 'secondary'}
                onClick={() => setUptimeRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>

        <div className="h-[240px] w-full">
          {uptimeData.length === 0 ? (
            <div className="h-full grid place-items-center text-[11.5px] text-pw-muted">
              No daily rollup history recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={uptimeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ebebf1" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9295a8' }} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: '#9295a8' }} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="uptimePct" name="Uptime (%)" fill="#16a477" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}

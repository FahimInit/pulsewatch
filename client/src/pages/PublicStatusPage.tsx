import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Wrench, ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/api/client';
import { MonitorStatusDot, IncidentStatusBadge } from '@/components/monitors/StatusBadge';
import { cn, formatDateTime, formatUptime } from '@/lib/utils';

interface PublicStatusResponse {
  statusPage: {
    name: string;
    slug: string;
    description: string | null;
    customHeadline: string | null;
    showUptimeHistory: boolean;
    showIncidents: boolean;
    overallStatus:
      | 'ALL_OPERATIONAL'
      | 'PARTIAL_DEGRADATION'
      | 'MAJOR_OUTAGE'
      | 'UNDER_MAINTENANCE';
    generatedAt: string;
  };
  services: Array<{
    id: string;
    displayName: string;
    groupName: string;
    status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'PAUSED' | 'PENDING';
    lastCheckedAt: string | null;
    lastResponseTimeMs: number | null;
    uptime90d: number | null;
    dailyBars: Array<{
      date: string;
      status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'NO_DATA';
      uptimePct: number | null;
    }>;
  }>;
  maintenanceWindows: Array<{
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    status: string;
  }>;
  incidents: Array<{
    id: string;
    serviceName: string;
    title: string;
    summary: string | null;
    severity: string;
    status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
    startedAt: string;
    resolvedAt: string | null;
    resolutionNotes: string | null;
    events: Array<{
      id: string;
      type: string;
      message: string;
      createdAt: string;
    }>;
  }>;
}

export function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();

  const statusQuery = useQuery({
    queryKey: ['public-status-page', slug],
    enabled: Boolean(slug),
    refetchInterval: 30_000,
    queryFn: () =>
      apiFetch<PublicStatusResponse>(`/public/status-pages/${slug}`, {
        skipAuth: true,
      }),
  });

  if (statusQuery.isLoading) {
    return (
      <div className="min-h-screen bg-pw-bg grid place-items-center text-pw-muted">
        Loading system status...
      </div>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <div className="min-h-screen bg-pw-bg grid place-items-center p-6">
        <div className="max-w-md rounded-pw border border-pw-border bg-white p-8 text-center">
          <h1 className="text-[18px] font-bold text-pw-text">Status Page Unavailable</h1>
          <p className="mt-2 text-[12px] text-pw-muted">
            This status page does not exist or is configured as private.
          </p>
        </div>
      </div>
    );
  }

  const { statusPage, services, maintenanceWindows, incidents } = statusQuery.data;

  const bannerConfig = {
    ALL_OPERATIONAL: {
      bg: 'bg-pw-green text-white',
      icon: CheckCircle2,
      text: statusPage.customHeadline || 'All Systems Operational',
    },
    PARTIAL_DEGRADATION: {
      bg: 'bg-pw-orange text-white',
      icon: AlertTriangle,
      text: 'Partial System Degradation',
    },
    MAJOR_OUTAGE: {
      bg: 'bg-pw-red text-white',
      icon: ShieldAlert,
      text: 'Major Service Outage Detected',
    },
    UNDER_MAINTENANCE: {
      bg: 'bg-pw-primary text-white',
      icon: Wrench,
      text: 'Scheduled Maintenance in Progress',
    },
  }[statusPage.overallStatus];

  const BannerIcon = bannerConfig.icon;

  return (
    <div className="min-h-screen bg-pw-bg text-pw-text py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-pw-primary text-white font-extrabold text-[16px]">
              P
            </div>
            <div>
              <h1 className="text-[20px] font-extrabold tracking-tight text-pw-text">
                {statusPage.name}
              </h1>
              {statusPage.description && (
                <p className="text-[12px] text-pw-muted">{statusPage.description}</p>
              )}
            </div>
          </div>
          <span className="text-[11px] text-pw-muted">
            Updated {formatDateTime(statusPage.generatedAt)}
          </span>
        </header>

        {/* Overall Status Banner */}
        <div
          className={cn(
            'rounded-pw px-6 py-5 flex items-center justify-between shadow-xs',
            bannerConfig.bg,
          )}
        >
          <div className="flex items-center gap-3">
            <BannerIcon className="h-6 w-6 shrink-0" />
            <strong className="text-[16px] font-bold">{bannerConfig.text}</strong>
          </div>
        </div>

        {/* Scheduled Maintenance Announcements */}
        {maintenanceWindows.length > 0 && (
          <section className="rounded-pw border border-[#ebe4ff] bg-[#f5f2ff] p-5 space-y-3">
            <div className="flex items-center gap-2 text-pw-primary font-bold text-[13px]">
              <Wrench className="h-4 w-4" />
              <span>Scheduled Maintenance</span>
            </div>
            {maintenanceWindows.map((mw) => (
              <div key={mw.id} className="border-t border-[#ebe4ff] pt-3 first:border-0 first:pt-0">
                <strong className="text-[12.5px] text-pw-text">{mw.title}</strong>
                {mw.description && (
                  <p className="text-[11.5px] text-pw-subtle mt-1">{mw.description}</p>
                )}
                <p className="text-[10.5px] text-pw-muted mt-1">
                  Window: {formatDateTime(mw.startsAt)} — {formatDateTime(mw.endsAt)} ({mw.status})
                </p>
              </div>
            ))}
          </section>
        )}

        {/* Services & 90-Day Uptime Bars */}
        <section className="rounded-pw border border-pw-border bg-white divide-y divide-pw-border">
          {services.length === 0 ? (
            <div className="p-8 text-center text-pw-muted">
              No public services attached to this status page yet.
            </div>
          ) : (
            services.map((svc) => (
              <div key={svc.id} className="p-5">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div>
                    <strong className="text-[13px] font-bold text-pw-text">
                      {svc.displayName}
                    </strong>
                    {svc.lastResponseTimeMs !== null && (
                      <span className="ml-2 text-[10.5px] text-pw-muted">
                        {svc.lastResponseTimeMs} ms
                      </span>
                    )}
                  </div>
                  <MonitorStatusDot status={svc.status} />
                </div>

                {statusPage.showUptimeHistory && svc.dailyBars.length > 0 && (
                  <div>
                    <div className="flex items-center gap-[2px] h-7">
                      {svc.dailyBars.map((bar) => (
                        <div
                          key={bar.date}
                          title={`${bar.date}: ${
                            bar.uptimePct !== null ? `${bar.uptimePct}% uptime` : 'No data'
                          }`}
                          className={cn(
                            'flex-1 h-full rounded-[2px] transition-opacity hover:opacity-80',
                            bar.status === 'OPERATIONAL'
                              ? 'bg-pw-green'
                              : bar.status === 'DEGRADED'
                                ? 'bg-pw-orange'
                                : bar.status === 'DOWN'
                                  ? 'bg-pw-red'
                                  : 'bg-[#ebebf2]',
                          )}
                        />
                      ))}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-pw-muted">
                      <span>90 days ago</span>
                      <span className="font-semibold text-pw-text">
                        {svc.uptime90d !== null
                          ? `${formatUptime(svc.uptime90d)} uptime`
                          : 'Collecting history'}
                      </span>
                      <span>Today</span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        {/* Incident History */}
        {statusPage.showIncidents && (
          <section className="rounded-pw border border-pw-border bg-white p-6">
            <h2 className="text-[15px] font-bold text-pw-text mb-4">Recent Incident History</h2>

            {incidents.length === 0 ? (
              <p className="text-[12px] text-pw-muted">
                No incidents reported across monitored services in the past 14 days.
              </p>
            ) : (
              <div className="space-y-5 divide-y divide-pw-border">
                {incidents.map((inc) => (
                  <div key={inc.id} className="pt-4 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong className="text-[13px] font-bold text-pw-text">{inc.title}</strong>
                        <span className="ml-2 text-[11px] text-pw-muted">({inc.serviceName})</span>
                      </div>
                      <IncidentStatusBadge status={inc.status} />
                    </div>
                    <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-pw-border">
                      {inc.events.map((ev) => (
                        <div key={ev.id} className="text-[11px]">
                          <span className="font-semibold text-pw-text">
                            {ev.type.replace(/_/g, ' ')}:
                          </span>{' '}
                          <span className="text-pw-subtle">{ev.message}</span>{' '}
                          <span className="text-[10px] text-pw-muted">
                            ({formatDateTime(ev.createdAt)})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="text-center text-[11px] text-pw-muted py-4">
          Powered by <strong className="text-pw-primary">Pulsewatch</strong> · Real-time API
          Monitoring
        </footer>
      </div>
    </div>
  );
}

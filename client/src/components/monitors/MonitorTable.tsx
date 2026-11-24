import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  MoreHorizontal,
  Play,
  Pause,
  RefreshCw,
  Pencil,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '@/api/client';
import { cn, extractHostname, formatRelativeTime, formatUptime } from '@/lib/utils';
import { MonitorStatusDot } from './StatusBadge';
import type { MonitorRecord } from './MonitorFormDialog';

const ICON_COLORS = [
  'bg-pw-primary-light text-pw-primary',
  'bg-pw-blue-bg text-pw-blue',
  'bg-pw-orange-bg text-pw-orange',
  'bg-pw-green-bg text-pw-green',
];

interface MonitorTableProps {
  projectId: string;
  monitors: MonitorRecord[];
  canMutate: boolean;
  onEdit?: (monitor: MonitorRecord) => void;
}

export function MonitorTable({
  projectId,
  monitors,
  canMutate,
  onEdit,
}: MonitorTableProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['monitors', projectId] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['analytics-overview', projectId] });
  };

  const pauseResumeMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' }) =>
      apiFetch(`/projects/${projectId}/monitors/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const checkNowMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectId}/monitors/${id}/check-now`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectId}/monitors/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  if (monitors.length === 0) {
    return (
      <div className="py-12 text-center text-[12px] text-pw-muted">
        No monitors match the current filter. Add an HTTP/HTTPS endpoint to start tracking uptime.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto mt-5">
      <table className="w-full border-collapse text-left whitespace-nowrap">
        <thead>
          <tr className="bg-[#fafafd] text-[9px] font-semibold tracking-[0.5px] text-pw-muted uppercase">
            <th className="py-[13px] px-3">Monitor</th>
            <th className="py-[13px] px-3">Status</th>
            <th className="py-[13px] px-3">Uptime (24h)</th>
            <th className="py-[13px] px-3">Response Time</th>
            <th className="py-[13px] px-3">Interval</th>
            <th className="py-[13px] px-3">Last Checked</th>
            <th className="py-[13px] px-3 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f0f4] text-[10.5px] text-pw-subtle">
          {monitors.map((m, index) => {
            const colorClass = ICON_COLORS[index % ICON_COLORS.length];
            const latency = m.lastResponseTimeMs ?? m.avgResponseTime24h;

            return (
              <tr
                key={m.id}
                onClick={() => navigate(`/monitors/${m.id}`)}
                className="hover:bg-[#fafbfe] cursor-pointer transition-colors"
              >
                <td className="py-[14px] px-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] font-bold text-[11px]',
                        colorClass,
                      )}
                    >
                      {m.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong className="block text-[11px] font-semibold text-pw-text">
                        {m.name}
                      </strong>
                      <small className="block text-[9.5px] text-pw-muted mt-0.5">
                        <span className="font-mono uppercase mr-1 text-[8.5px] text-pw-primary">
                          {m.method}
                        </span>
                        {extractHostname(m.url)}
                      </small>
                    </div>
                  </div>
                </td>
                <td className="py-[14px] px-3">
                  <MonitorStatusDot status={m.status} />
                </td>
                <td className="py-[14px] px-3 font-medium text-pw-text">
                  {formatUptime(m.uptime24h)}
                </td>
                <td className="py-[14px] px-3">
                  {latency !== null && latency !== undefined ? `${latency} ms` : '—'}
                </td>
                <td className="py-[14px] px-3 text-pw-muted">{m.intervalSeconds}s</td>
                <td className="py-[14px] px-3 text-pw-muted">
                  {formatRelativeTime(m.lastCheckedAt)}
                </td>
                <td
                  className="py-[14px] px-3 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Monitor actions"
                        className="rounded-md p-1.5 text-pw-muted hover:bg-pw-bg hover:text-pw-text"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="end"
                        sideOffset={4}
                        className="z-50 w-44 rounded-[10px] border border-pw-border bg-white p-1.5 shadow-lg text-[11.5px]"
                      >
                        <DropdownMenu.Item
                          onSelect={() => navigate(`/monitors/${m.id}`)}
                          className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-pw-text outline-none hover:bg-pw-bg cursor-pointer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Inspect Metrics
                        </DropdownMenu.Item>

                        {canMutate && (
                          <>
                            {m.status !== 'PAUSED' && (
                              <DropdownMenu.Item
                                onSelect={() => checkNowMut.mutate(m.id)}
                                className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-pw-text outline-none hover:bg-pw-bg cursor-pointer"
                              >
                                <RefreshCw className="h-3.5 w-3.5 text-pw-primary" />
                                Check Now
                              </DropdownMenu.Item>
                            )}

                            <DropdownMenu.Item
                              onSelect={() =>
                                pauseResumeMut.mutate({
                                  id: m.id,
                                  action: m.status === 'PAUSED' ? 'resume' : 'pause',
                                })
                              }
                              className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-pw-text outline-none hover:bg-pw-bg cursor-pointer"
                            >
                              {m.status === 'PAUSED' ? (
                                <>
                                  <Play className="h-3.5 w-3.5 text-pw-green" /> Resume Monitor
                                </>
                              ) : (
                                <>
                                  <Pause className="h-3.5 w-3.5 text-pw-orange" /> Pause Monitor
                                </>
                              )}
                            </DropdownMenu.Item>

                            {onEdit && (
                              <DropdownMenu.Item
                                onSelect={() => onEdit(m)}
                                className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-pw-text outline-none hover:bg-pw-bg cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit Configuration
                              </DropdownMenu.Item>
                            )}

                            <DropdownMenu.Separator className="my-1 h-px bg-pw-border" />
                            <DropdownMenu.Item
                              onSelect={() => {
                                if (window.confirm(`Delete monitor "${m.name}"?`)) {
                                  deleteMut.mutate(m.id);
                                }
                              }}
                              className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-pw-red outline-none hover:bg-pw-red-bg cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete Monitor
                            </DropdownMenu.Item>
                          </>
                        )}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

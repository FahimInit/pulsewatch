import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useAuthStore, type WorkspaceProject } from '@/stores/auth-store';
import { apiFetch } from '@/api/client';
import { cn, formatRelativeTime, getInitials } from '@/lib/utils';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/monitors': 'Monitors',
  '/incidents': 'Incidents',
  '/status-pages': 'Status Pages',
  '/analytics': 'Analytics',
  '/alert-rules': 'Alert Rules',
  '/settings': 'Settings',
};

export function Topbar({ activeProject }: { activeProject: WorkspaceProject | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const socketConnected = useAuthStore((s) => s.socketConnected);

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications').catch(
        () => ({ notifications: [], unreadCount: 0 }),
      ),
    refetchInterval: 30_000,
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const baseSegment =
    location.pathname === '/'
      ? '/'
      : `/${location.pathname.split('/').filter(Boolean)[0] || ''}`;
  const currentSection = ROUTE_TITLES[baseSegment] || 'Details';
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const notifications = notificationsQuery.data?.notifications ?? [];

  return (
    <header className="h-[66px] bg-white border-b border-pw-border px-4 md:px-[35px] flex items-center justify-between shrink-0">
      <div className="text-[12.5px] text-pw-muted truncate">
        <span>{activeProject?.name || 'Workspace'}</span>
        <span className="mx-2 text-pw-border">/</span>
        <span className="font-medium text-pw-text">{currentSection}</span>
      </div>

      <div className="flex items-center gap-4 md:gap-5">
        {/* Live updates indicator */}
        <div className="hidden sm:flex items-center gap-[7px] text-[11px] text-[#777a90]">
          <span
            className={cn(
              'h-[7px] w-[7px] rounded-full transition-colors',
              socketConnected
                ? 'bg-pw-green shadow-[0_0_0_4px_#e4f8f0]'
                : 'bg-pw-orange shadow-[0_0_0_4px_#fff5e8]',
            )}
          />
          <span>{socketConnected ? 'Live updates' : 'Syncing'}</span>
        </div>

        {/* Notifications Popover */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Notifications"
              className="relative rounded-[8px] p-2 text-[#777a90] hover:bg-pw-bg hover:text-pw-primary transition-colors"
            >
              <Bell className="h-[17px] w-[17px]" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] h-[16px] place-items-center rounded-full bg-pw-red px-1 text-[9px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              className="z-50 w-[340px] rounded-[12px] border border-pw-border bg-white shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-pw-border px-4 py-3">
                <div>
                  <h4 className="text-[12.5px] font-bold text-pw-text">Notifications</h4>
                  <p className="text-[10px] text-pw-muted">{unreadCount} unread alerts</p>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllRead.mutate()}
                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-pw-primary hover:underline"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[320px] overflow-y-auto divide-y divide-pw-border">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[11px] text-pw-muted">
                    No notifications yet. Alerts will appear here in real time.
                  </div>
                ) : (
                  notifications.slice(0, 15).map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (!n.readAt) markOneRead.mutate(n.id);
                      }}
                      className={cn(
                        'px-4 py-3 cursor-pointer transition-colors hover:bg-pw-bg',
                        !n.readAt ? 'bg-[#faf8ff]' : 'bg-white',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[11px] font-semibold text-pw-text">
                          {n.title}
                        </strong>
                        {!n.readAt && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pw-primary" />
                        )}
                      </div>
                      <p className="mt-1 text-[10.5px] text-pw-subtle line-clamp-2">{n.body}</p>
                      <span className="mt-1.5 block text-[9.5px] text-pw-muted">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* Top Avatar */}
        <button
          type="button"
          onClick={() => navigate('/settings')}
          title={user?.name || 'Account settings'}
          className="grid h-[34px] w-[34px] place-items-center rounded-[8px] bg-pw-primary-light text-[10px] font-bold text-pw-primary hover:ring-2 hover:ring-pw-primary/25 transition"
        >
          {getInitials(user?.name)}
        </button>
      </div>
    </header>
  );
}

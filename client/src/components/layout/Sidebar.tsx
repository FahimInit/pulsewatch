import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutGrid,
  Radio,
  AlertTriangle,
  Globe,
  BarChart3,
  BellRing,
  Settings,
  ChevronDown,
  Plus,
  LogOut,
  MoreHorizontal,
  Check,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuthStore, type WorkspaceProject } from '@/stores/auth-store';
import { apiFetch } from '@/api/client';
import { cn, getInitials } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';

interface SidebarProps {
  projects: WorkspaceProject[];
  activeProject: WorkspaceProject | null;
}

export function Sidebar({ projects, activeProject }: SidebarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [createOpen, setCreateOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const createProjectMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ project: WorkspaceProject }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projName.trim(),
          description: projDesc.trim() || null,
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setActiveProjectId(data.project.id);
      setProjName('');
      setProjDesc('');
      setCreateError(null);
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      setCreateError(err.message);
    },
  });

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore network failure during logout
    } finally {
      clearSession();
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  };

  const navItemsWorkspace = [
    { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
    {
      to: '/monitors',
      label: 'Monitors',
      icon: Radio,
      count: activeProject?.monitorCount ?? 0,
      alert: false,
    },
    {
      to: '/incidents',
      label: 'Incidents',
      icon: AlertTriangle,
      count: activeProject?.activeIncidentCount ?? 0,
      alert: (activeProject?.activeIncidentCount ?? 0) > 0,
    },
    { to: '/status-pages', label: 'Status Pages', icon: Globe },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  ];

  const navItemsConfig = [
    { to: '/alert-rules', label: 'Alert Rules', icon: BellRing },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      <aside className="w-[65px] md:w-[250px] bg-white border-r border-pw-border px-2.5 md:px-4 pt-6 pb-3.5 flex flex-col shrink-0 select-none">
        {/* Brand */}
        <div className="flex items-center justify-center md:justify-start gap-2.5 px-0 md:px-2 pb-7">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-pw-primary text-[16px] font-extrabold text-white">
            P
          </div>
          <span className="hidden md:inline text-[20px] font-extrabold tracking-[-0.8px] text-pw-text">
            pulsewatch
          </span>
        </div>

        {/* Workspace Switcher */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="hidden md:flex items-center gap-2.5 p-3 border border-pw-border rounded-[10px] mb-7 text-left hover:border-pw-primary/40 transition-colors w-full bg-white"
            >
              <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] bg-pw-primary-light font-bold text-pw-primary text-[12px]">
                {getInitials(activeProject?.name || 'Workspace').slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[11px] font-semibold text-pw-text">
                  {activeProject?.name || 'Select Workspace'}
                </strong>
                <small className="block text-[10px] text-pw-muted mt-0.5">
                  {activeProject?.planTier === 'PRO'
                    ? 'Pro Plan'
                    : activeProject?.planTier === 'TEAM'
                      ? 'Team Plan'
                      : 'Free Plan'}
                </small>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-pw-muted shrink-0" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[225px] rounded-[10px] border border-pw-border bg-white p-1.5 shadow-lg"
            >
              <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-pw-muted">
                Your Workspaces
              </div>
              {projects.map((p) => (
                <DropdownMenu.Item
                  key={p.id}
                  onSelect={() => setActiveProjectId(p.id)}
                  className="flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-2 text-[11.5px] text-pw-text outline-none hover:bg-pw-bg cursor-pointer"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  {p.id === activeProject?.id && (
                    <Check className="h-3.5 w-3.5 text-pw-primary shrink-0" />
                  )}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="my-1 h-px bg-pw-border" />
              <DropdownMenu.Item
                onSelect={() => setCreateOpen(true)}
                className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-[11.5px] font-semibold text-pw-primary outline-none hover:bg-pw-primary-light cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                New Project
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Navigation */}
        <nav className="flex-1">
          <p className="hidden md:block text-[9px] tracking-[1px] font-bold text-pw-muted px-2.5 mb-3">
            WORKSPACE
          </p>

          {navItemsWorkspace.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-center md:justify-start gap-3 px-0 md:px-2.5 py-3 rounded-[8px] mb-1 font-medium transition-colors',
                    isActive
                      ? 'bg-pw-primary-light text-pw-primary font-semibold'
                      : 'text-[#777a90] hover:bg-pw-bg hover:text-pw-primary',
                  )
                }
              >
                <Icon className="h-[17px] w-[17px] shrink-0" />
                <span className="hidden md:inline text-[12.5px]">{item.label}</span>
                {typeof item.count === 'number' && (item.count > 0 || item.label === 'Monitors') && (
                  <span
                    className={cn(
                      'hidden md:inline-block ml-auto rounded-[5px] px-[7px] py-[3px] text-[10px] font-semibold leading-none',
                      item.alert
                        ? 'bg-pw-red-bg text-pw-red'
                        : 'bg-[#f0f0f5] text-[#777a90]',
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </NavLink>
            );
          })}

          <p className="hidden md:block text-[9px] tracking-[1px] font-bold text-pw-muted px-2.5 mt-5 mb-3">
            CONFIGURATION
          </p>

          {navItemsConfig.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-center md:justify-start gap-3 px-0 md:px-2.5 py-3 rounded-[8px] mb-1 font-medium transition-colors',
                    isActive
                      ? 'bg-pw-primary-light text-pw-primary font-semibold'
                      : 'text-[#777a90] hover:bg-pw-bg hover:text-pw-primary',
                  )
                }
              >
                <Icon className="h-[17px] w-[17px] shrink-0" />
                <span className="hidden md:inline text-[12.5px]">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Quota Card + User Profile */}
        <div className="hidden md:block mt-auto pt-4">
          <div className="rounded-[10px] border border-[#ebe4ff] bg-[#f5f2ff] p-[15px] mb-5">
            <strong className="block text-[11px] text-pw-text">
              {activeProject
                ? `${activeProject.monitorCount} / ${activeProject.monitorLimit} monitors used`
                : 'Monitor quota'}
            </strong>
            <p className="text-[10px] leading-[1.6] text-[#85819b] my-2">
              Manage workspace settings, collaborators, and monitoring capacity.
            </p>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="text-[11px] font-bold text-pw-primary hover:underline"
            >
              Workspace settings →
            </button>
          </div>

          <div className="flex items-center gap-2.5 border-t border-pw-border pt-4">
            <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] bg-pw-primary-light text-[10px] font-bold text-pw-primary">
              {getInitials(user?.name)}
            </div>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[11px] text-pw-text">
                {user?.name || 'Developer'}
              </strong>
              <small className="block truncate text-[10px] text-pw-muted mt-0.5">
                {user?.email}
              </small>
            </div>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="User menu"
                  className="rounded-md p-1 text-pw-muted hover:bg-pw-bg hover:text-pw-text"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 w-44 rounded-[10px] border border-pw-border bg-white p-1.5 shadow-lg"
                >
                  <DropdownMenu.Item
                    onSelect={() => navigate('/settings')}
                    className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-[11.5px] text-pw-text outline-none hover:bg-pw-bg cursor-pointer"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Account &amp; Workspace
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-pw-border" />
                  <DropdownMenu.Item
                    onSelect={handleLogout}
                    className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-[11.5px] text-pw-red outline-none hover:bg-pw-red-bg cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </aside>

      {/* New Project Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace Project</DialogTitle>
            <DialogDescription>
              Organize monitors, incidents, alert rules, and status pages in a dedicated project.
            </DialogDescription>
          </DialogHeader>

          {createError && (
            <div className="mb-3 rounded-[8px] bg-pw-red-bg px-3 py-2 text-[11px] text-pw-red">
              {createError}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!projName.trim()) return;
              createProjectMutation.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="proj-name">Project Name</Label>
              <Input
                id="proj-name"
                placeholder="e.g. Production Platform"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="proj-desc">Description (optional)</Label>
              <Textarea
                id="proj-desc"
                placeholder="Core customer-facing microservices and APIs"
                value={projDesc}
                onChange={(e) => setProjDesc(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createProjectMutation.isPending}>
                {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

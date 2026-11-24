import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { useAuthStore, type WorkspaceProject } from '@/stores/auth-store';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export interface OutletWorkspaceContext {
  projects: WorkspaceProject[];
  activeProject: WorkspaceProject | null;
}

export function AppShell() {
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<{ projects: WorkspaceProject[] }>('/projects'),
  });

  const projects = projectsQuery.data?.projects ?? [];
  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (projects.length > 0 && (!activeProjectId || !projects.some((p) => p.id === activeProjectId))) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId, setActiveProjectId]);

  return (
    <div className="flex min-h-screen bg-pw-bg text-pw-text">
      <Sidebar projects={projects} activeProject={activeProject} />

      <main className="flex-1 min-w-0 flex flex-col">
        <Topbar activeProject={activeProject} />

        <section className="flex-1 px-4 py-6 md:px-[35px] md:py-[32px] max-w-[1600px] w-full mx-auto">
          {projectsQuery.isLoading ? (
            <div className="rounded-pw border border-pw-border bg-white p-10 text-center text-[12px] text-pw-muted">
              Loading workspace...
            </div>
          ) : (
            <Outlet context={{ projects, activeProject } satisfies OutletWorkspaceContext} />
          )}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 px-0.5 py-3 text-[9.5px] text-pw-muted">
            <span>© 2026 Pulsewatch</span>
            <span>
              {activeProject && activeProject.activeIncidentCount > 0
                ? `${activeProject.activeIncidentCount} active incident(s) under investigation`
                : 'System operational · Monitoring workers active'}
            </span>
            <span>API Monitoring &amp; Incident Management</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

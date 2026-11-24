import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Users, Trash2, UserPlus, KeyRound, CheckCircle2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/api/client';
import { useAuthStore } from '@/stores/auth-store';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';

interface MemberRecord {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  joinedAt: string;
  user: { id: string; name: string; email: string };
}

interface AuditRecord {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actor?: { name: string; email: string } | null;
}

export function SettingsPage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);

  const [projectName, setProjectName] = useState(activeProject?.name || '');
  const [projectDesc, setProjectDesc] = useState(activeProject?.description || '');
  const [profileName, setProfileName] = useState(user?.name || '');
  const [timezone, setTimezone] = useState(user?.timezone || 'UTC');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER' | 'VIEWER'>('MEMBER');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setProjectName(activeProject?.name || '');
    setProjectDesc(activeProject?.description || '');
  }, [activeProject?.id, activeProject?.name, activeProject?.description]);

  const membersQuery = useQuery({
    queryKey: ['project-members', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ members: MemberRecord[] }>(`/projects/${activeProject!.id}/members`),
  });

  const auditQuery = useQuery({
    queryKey: ['project-audit', activeProject?.id],
    enabled: Boolean(activeProject?.id && activeProject.role !== 'VIEWER'),
    queryFn: () =>
      apiFetch<{ auditLogs: AuditRecord[] }>(`/projects/${activeProject!.id}/audit-logs?limit=25`),
  });

  const updateProjectMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: projectName, description: projectDesc || null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setFeedback({ type: 'ok', text: 'Workspace settings saved.' });
    },
    onError: (e: Error) => setFeedback({ type: 'err', text: e.message }),
  });

  const deleteProjectMut = useMutation({
    mutationFn: () => apiFetch(`/projects/${activeProject!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setActiveProjectId(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setFeedback({ type: 'ok', text: 'Project deleted.' });
    },
    onError: (e: Error) => setFeedback({ type: 'err', text: e.message }),
  });

  const inviteMut = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${activeProject!.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      }),
    onSuccess: () => {
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['project-members', activeProject?.id] });
      setFeedback({ type: 'ok', text: 'Collaborator added to project.' });
    },
    onError: (e: Error) => setFeedback({ type: 'err', text: e.message }),
  });

  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) =>
      apiFetch(`/projects/${activeProject!.id}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-members', activeProject?.id] });
    },
  });

  const profileMut = useMutation({
    mutationFn: () =>
      apiFetch<{ user: typeof user }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: profileName, timezone }),
      }),
    onSuccess: (res) => {
      if (res.user) setUser(res.user);
      setFeedback({ type: 'ok', text: 'Profile updated.' });
    },
    onError: (e: Error) => setFeedback({ type: 'err', text: e.message }),
  });

  const passwordMut = useMutation({
    mutationFn: () =>
      apiFetch('/auth/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ type: 'ok', text: 'Password updated successfully.' });
    },
    onError: (e: Error) =>
      setFeedback({ type: 'err', text: e instanceof ApiClientError ? e.message : 'Failed' }),
  });

  if (!activeProject) return null;
  const canManageProject = activeProject.role === 'OWNER' || activeProject.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2">
          CONFIGURATION
        </p>
        <h1 className="text-[24px] font-bold tracking-[-0.8px] text-pw-text">
          Workspace &amp; Account Settings
        </h1>
        <p className="text-[12px] text-pw-muted mt-1">
          Manage project settings, team access controls, user profile, and security audit logs.
        </p>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-[8px] px-4 py-2.5 text-[11.5px] font-medium ${
            feedback.type === 'ok'
              ? 'bg-pw-green-bg text-pw-green border border-pw-green/20'
              : 'bg-pw-red-bg text-pw-red border border-pw-red/20'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Project Settings */}
        <section className="rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[14px] font-bold text-pw-text">Project Settings</h3>
              <p className="text-[10.5px] text-pw-muted">
                Slug: <code className="text-pw-primary">{activeProject.slug}</code> · Your role:{' '}
                <strong>{activeProject.role}</strong>
              </p>
            </div>
            <Badge variant="purple">{activeProject.planTier}</Badge>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateProjectMut.mutate();
            }}
            className="space-y-3.5"
          >
            <div>
              <Label>Project Name</Label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={!canManageProject}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                disabled={!canManageProject}
              />
            </div>
            {canManageProject && (
              <div className="flex items-center justify-between pt-2">
                <Button type="submit" disabled={updateProjectMut.isPending}>
                  {updateProjectMut.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
                {activeProject.role === 'OWNER' && (
                  <Button
                    type="button"
                    variant="outlineDanger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Delete project "${activeProject.name}" permanently?`)) {
                        deleteProjectMut.mutate();
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Project
                  </Button>
                )}
              </div>
            )}
          </form>
        </section>

        {/* User Profile & Password */}
        <section className="rounded-pw border border-pw-border bg-white p-5 space-y-5">
          <div>
            <h3 className="text-[14px] font-bold text-pw-text">Your Profile</h3>
            <p className="text-[10.5px] text-pw-muted">{user?.email}</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              profileMut.mutate();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            <div>
              <Label>Display Name</Label>
              <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={profileMut.isPending}>
                Update Profile
              </Button>
            </div>
          </form>

          <div className="border-t border-pw-border pt-4">
            <div className="flex items-center gap-1.5 mb-3">
              <KeyRound className="h-3.5 w-3.5 text-pw-primary" />
              <h4 className="text-[12.5px] font-bold text-pw-text">Change Password</h4>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                passwordMut.mutate();
              }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <div>
                <Label>Current Password</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary" size="sm" disabled={passwordMut.isPending}>
                  Rotate Password
                </Button>
              </div>
            </form>
          </div>
        </section>
      </div>

      {/* Team Members */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-pw-primary" />
            <div>
              <h3 className="text-[14px] font-bold text-pw-text">Project Collaborators</h3>
              <p className="text-[10.5px] text-pw-muted">
                Role-based access control for monitors, incidents, and alerts
              </p>
            </div>
          </div>

          {canManageProject && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!inviteEmail.trim()) return;
                inviteMut.mutate();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <Input
                type="email"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-52 h-8 text-[11px]"
                required
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER' | 'VIEWER')}
                className="h-8 rounded-[8px] border border-pw-border bg-white px-2.5 text-[11px]"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="MEMBER">MEMBER</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <Button type="submit" size="sm" disabled={inviteMut.isPending}>
                <UserPlus className="h-3.5 w-3.5" />
                Add Member
              </Button>
            </form>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fafafd] text-[9.5px] font-semibold uppercase tracking-wider text-pw-muted">
                <th className="py-2.5 px-3">Member</th>
                <th className="py-2.5 px-3">Email</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Joined</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f4] text-[11px]">
              {(membersQuery.data?.members ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="py-3 px-3 font-semibold text-pw-text">{m.user.name}</td>
                  <td className="py-3 px-3 text-pw-subtle">{m.user.email}</td>
                  <td className="py-3 px-3">
                    <Badge variant={m.role === 'OWNER' ? 'purple' : 'pending'}>{m.role}</Badge>
                  </td>
                  <td className="py-3 px-3 text-pw-muted">{formatDateTime(m.joinedAt)}</td>
                  <td className="py-3 px-3 text-right">
                    {canManageProject && m.role !== 'OWNER' && (
                      <button
                        type="button"
                        onClick={() => removeMemberMut.mutate(m.id)}
                        className="text-[10.5px] font-semibold text-pw-red hover:underline"
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
      </section>

      {/* Security Audit Log */}
      {activeProject.role !== 'VIEWER' && (
        <section className="rounded-pw border border-pw-border bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-4 w-4 text-pw-primary" />
            <div>
              <h3 className="text-[14px] font-bold text-pw-text">Project Audit Trail</h3>
              <p className="text-[10.5px] text-pw-muted">Recent security and configuration events</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fafafd] text-[9.5px] font-semibold uppercase tracking-wider text-pw-muted">
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Entity</th>
                  <th className="py-2.5 px-3">Actor</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f4] text-[11px]">
                {(auditQuery.data?.auditLogs ?? []).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-3 font-mono text-[10.5px] text-pw-primary">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-3 text-pw-subtle">{log.entityType}</td>
                    <td className="py-2.5 px-3 text-pw-text">
                      {log.actor ? `${log.actor.name} (${log.actor.email})` : 'System'}
                    </td>
                    <td className="py-2.5 px-3 text-pw-muted">{formatDateTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

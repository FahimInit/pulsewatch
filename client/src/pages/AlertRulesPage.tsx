import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus, Trash2, Mail, Bell, AlertCircle } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/api/client';
import { useAuthStore } from '@/stores/auth-store';
import type { OutletWorkspaceContext } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { MonitorRecord } from '@/components/monitors/MonitorFormDialog';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';

interface AlertRuleRecord {
  id: string;
  name: string;
  monitorId: string | null;
  triggerType:
    | 'MONITOR_DOWN'
    | 'MONITOR_RECOVERED'
    | 'HIGH_LATENCY'
    | 'INCIDENT_CREATED'
    | 'INCIDENT_RESOLVED';
  thresholdValue: number | null;
  cooldownMinutes: number;
  channels: Array<'IN_APP' | 'EMAIL'>;
  recipientEmails: string[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  monitor?: { id: string; name: string } | null;
}

interface DeliveryLogItem {
  id: string;
  channel: 'IN_APP' | 'EMAIL';
  type: string;
  title: string;
  recipientEmail: string | null;
  deliveryStatus: 'PENDING' | 'SENT' | 'FAILED';
  createdAt: string;
  monitor?: { name: string } | null;
}

export function AlertRulesPage() {
  const { activeProject } = useOutletContext<OutletWorkspaceContext>();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [monitorId, setMonitorId] = useState<string>('');
  const [triggerType, setTriggerType] =
    useState<AlertRuleRecord['triggerType']>('INCIDENT_CREATED');
  const [thresholdValue, setThresholdValue] = useState(800);
  const [cooldownMinutes, setCooldownMinutes] = useState(15);
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailsText, setEmailsText] = useState(user?.email || '');
  const [error, setError] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ['alert-rules', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ alertRules: AlertRuleRecord[] }>(`/projects/${activeProject!.id}/alert-rules`),
  });

  const monitorsQuery = useQuery({
    queryKey: ['monitors', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ monitors: MonitorRecord[] }>(`/projects/${activeProject!.id}/monitors`),
  });

  const deliveryQuery = useQuery({
    queryKey: ['project-notifications', activeProject?.id],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      apiFetch<{ notifications: DeliveryLogItem[] }>(
        `/projects/${activeProject!.id}/notifications?limit=30`,
      ),
  });

  const createRuleMut = useMutation({
    mutationFn: () => {
      const channels: Array<'IN_APP' | 'EMAIL'> = [];
      if (inAppEnabled) channels.push('IN_APP');
      if (emailEnabled) channels.push('EMAIL');

      const recipientEmails = emailsText
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      return apiFetch(`/projects/${activeProject!.id}/alert-rules`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          monitorId: monitorId || null,
          triggerType,
          thresholdValue: triggerType === 'HIGH_LATENCY' ? Number(thresholdValue) : null,
          cooldownMinutes: Number(cooldownMinutes),
          channels,
          recipientEmails,
          enabled: true,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules', activeProject?.id] });
      setName('');
      setError(null);
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      setError(err instanceof ApiClientError ? err.message : err.message);
    },
  });

  const toggleRuleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/projects/${activeProject!.id}/alert-rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules', activeProject?.id] });
    },
  });

  const deleteRuleMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${activeProject!.id}/alert-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules', activeProject?.id] });
    },
  });

  if (!activeProject) return null;
  const canMutate = activeProject.role !== 'VIEWER';
  const rules = rulesQuery.data?.alertRules ?? [];
  const deliveries = deliveryQuery.data?.notifications ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold tracking-[1.3px] text-pw-primary uppercase mb-2">
            ALERT ROUTING
          </p>
          <h1 className="text-[25px] font-bold tracking-[-1px] text-pw-text">Alert Rules</h1>
          <p className="text-[12px] text-pw-muted mt-1">
            Configure outage, recovery, and high-latency notifications across in-app and email
            channels.
          </p>
        </div>

        {canMutate && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Alert Rule
          </Button>
        )}
      </div>

      {/* Rules Table */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <div className="flex items-center gap-2 mb-4">
          <BellRing className="h-4 w-4 text-pw-primary" />
          <h3 className="text-[14px] font-bold text-pw-text">Configured Rules</h3>
        </div>

        {rules.length === 0 ? (
          <div className="py-10 text-center text-pw-muted">
            No alert rules configured for this workspace.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left whitespace-nowrap">
              <thead>
                <tr className="bg-[#fafafd] text-[9px] font-semibold uppercase tracking-wider text-pw-muted">
                  <th className="py-3 px-3">Rule Name</th>
                  <th className="py-3 px-3">Scope</th>
                  <th className="py-3 px-3">Trigger</th>
                  <th className="py-3 px-3">Channels</th>
                  <th className="py-3 px-3">Cooldown</th>
                  <th className="py-3 px-3">Last Fired</th>
                  <th className="py-3 px-3 text-right">Status / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f4] text-[11px]">
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="py-3.5 px-3 font-semibold text-pw-text">{rule.name}</td>
                    <td className="py-3.5 px-3 text-pw-subtle">
                      {rule.monitor ? rule.monitor.name : 'All Project Monitors'}
                    </td>
                    <td className="py-3.5 px-3">
                      <Badge variant="purple">
                        {rule.triggerType.replace(/_/g, ' ')}
                        {rule.triggerType === 'HIGH_LATENCY' && rule.thresholdValue
                          ? ` (>${rule.thresholdValue}ms)`
                          : ''}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-2">
                        {rule.channels.includes('IN_APP') && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pw-primary">
                            <Bell className="h-3 w-3" /> In-App
                          </span>
                        )}
                        {rule.channels.includes('EMAIL') && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pw-blue">
                            <Mail className="h-3 w-3" /> Email ({rule.recipientEmails.length})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-pw-muted">{rule.cooldownMinutes}m</td>
                    <td className="py-3.5 px-3 text-pw-muted">
                      {formatRelativeTime(rule.lastTriggeredAt)}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!canMutate}
                          onClick={() =>
                            toggleRuleMut.mutate({ id: rule.id, enabled: !rule.enabled })
                          }
                          className={`rounded-[6px] px-2.5 py-1 text-[10px] font-semibold ${
                            rule.enabled
                              ? 'bg-pw-green-bg text-pw-green'
                              : 'bg-[#f0f0f5] text-pw-muted'
                          }`}
                        >
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        {canMutate && (
                          <button
                            type="button"
                            onClick={() => deleteRuleMut.mutate(rule.id)}
                            className="p-1 text-pw-muted hover:text-pw-red"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Delivery Log */}
      <section className="rounded-pw border border-pw-border bg-white p-5">
        <h3 className="text-[14px] font-bold text-pw-text">Recent Alert Deliveries</h3>
        <p className="text-[10.5px] text-pw-muted mt-0.5">
          Audit log of in-app and SMTP email dispatches
        </p>

        <div className="overflow-x-auto mt-4">
          <table className="w-full border-collapse text-left whitespace-nowrap">
            <thead>
              <tr className="bg-[#fafafd] text-[9px] font-semibold uppercase tracking-wider text-pw-muted">
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Alert</th>
                <th className="py-2.5 px-3">Recipient</th>
                <th className="py-2.5 px-3">Delivery</th>
                <th className="py-2.5 px-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f4] text-[10.5px]">
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-pw-muted">
                    No alert deliveries dispatched yet.
                  </td>
                </tr>
              ) : (
                deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-3 px-3 font-mono text-[10px] text-pw-primary">{d.channel}</td>
                    <td className="py-3 px-3 font-medium text-pw-text">{d.title}</td>
                    <td className="py-3 px-3 text-pw-subtle">
                      {d.recipientEmail || 'Workspace Member (In-App)'}
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant={
                          d.deliveryStatus === 'SENT'
                            ? 'operational'
                            : d.deliveryStatus === 'FAILED'
                              ? 'down'
                              : 'pending'
                        }
                      >
                        {d.deliveryStatus}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-pw-muted">{formatDateTime(d.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create Rule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Alert Rule</DialogTitle>
            <DialogDescription>
              Define when and where Pulsewatch sends notifications when monitor health changes.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-[8px] bg-pw-red-bg px-3 py-2 text-[11px] text-pw-red">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createRuleMut.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label>Rule Name</Label>
              <Input
                placeholder="Critical API Latency Warning"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Monitor Scope</Label>
                <select
                  value={monitorId}
                  onChange={(e) => setMonitorId(e.target.value)}
                  className="flex h-9 w-full rounded-[8px] border border-pw-border bg-white px-2.5 text-[12px]"
                >
                  <option value="">All Monitors in Project</option>
                  {(monitorsQuery.data?.monitors ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>Trigger Event</Label>
                <select
                  value={triggerType}
                  onChange={(e) =>
                    setTriggerType(e.target.value as AlertRuleRecord['triggerType'])
                  }
                  className="flex h-9 w-full rounded-[8px] border border-pw-border bg-white px-2.5 text-[12px]"
                >
                  <option value="INCIDENT_CREATED">Incident Created</option>
                  <option value="INCIDENT_RESOLVED">Incident Resolved</option>
                  <option value="MONITOR_DOWN">Monitor Down</option>
                  <option value="MONITOR_RECOVERED">Monitor Recovered</option>
                  <option value="HIGH_LATENCY">High Response Time</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {triggerType === 'HIGH_LATENCY' && (
                <div>
                  <Label>Latency Threshold (ms)</Label>
                  <Input
                    type="number"
                    min={50}
                    max={30000}
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(Number(e.target.value))}
                  />
                </div>
              )}
              <div>
                <Label>Cooldown Window (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={cooldownMinutes}
                  onChange={(e) => setCooldownMinutes(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Delivery Channels</Label>
              <div className="flex items-center gap-5">
                <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inAppEnabled}
                    onChange={(e) => setInAppEnabled(e.target.checked)}
                    className="accent-pw-primary"
                  />
                  In-App Notification Bell
                </label>
                <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={emailEnabled}
                    onChange={(e) => setEmailEnabled(e.target.checked)}
                    className="accent-pw-primary"
                  />
                  SMTP Email Alert
                </label>
              </div>
            </div>

            {emailEnabled && (
              <div>
                <Label>Recipient Emails (comma-separated)</Label>
                <Input
                  placeholder="oncall@company.com, ops@company.com"
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createRuleMut.isPending}>
                {createRuleMut.isPending ? 'Saving...' : 'Create Rule'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

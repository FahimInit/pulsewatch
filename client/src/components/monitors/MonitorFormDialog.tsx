import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/api/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';

export interface MonitorRecord {
  id: string;
  projectId: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  headers: Record<string, string>;
  body?: string | null;
  expectedStatusCodes: number[];
  timeoutMs: number;
  intervalSeconds: number;
  degradedThresholdMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  keyword?: string | null;
  keywordMatchType?: 'CONTAINS' | 'NOT_CONTAINS' | null;
  followRedirects: boolean;
  status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'PAUSED' | 'PENDING';
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt?: string | null;
  lastResponseTimeMs?: number | null;
  uptime24h?: number | null;
  uptime30d?: number | null;
  avgResponseTime24h?: number | null;
}

interface MonitorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initialMonitor?: MonitorRecord | null;
}

export function MonitorFormDialog({
  open,
  onOpenChange,
  projectId,
  initialMonitor,
}: MonitorFormDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialMonitor);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [method, setMethod] = useState<'GET' | 'POST' | 'HEAD'>('GET');
  const [statusCodesText, setStatusCodesText] = useState('200, 201, 204');
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [degradedThresholdMs, setDegradedThresholdMs] = useState(1000);
  const [failureThreshold, setFailureThreshold] = useState(2);
  const [recoveryThreshold, setRecoveryThreshold] = useState(2);
  const [keyword, setKeyword] = useState('');
  const [keywordMatchType, setKeywordMatchType] = useState<'CONTAINS' | 'NOT_CONTAINS'>('CONTAINS');
  const [body, setBody] = useState('');
  const [followRedirects, setFollowRedirects] = useState(true);
  const [headerPairs, setHeaderPairs] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialMonitor) {
      setName(initialMonitor.name);
      setUrl(initialMonitor.url);
      setMethod(initialMonitor.method);
      setStatusCodesText(initialMonitor.expectedStatusCodes.join(', '));
      setIntervalSeconds(initialMonitor.intervalSeconds);
      setTimeoutMs(initialMonitor.timeoutMs);
      setDegradedThresholdMs(initialMonitor.degradedThresholdMs);
      setFailureThreshold(initialMonitor.failureThreshold);
      setRecoveryThreshold(initialMonitor.recoveryThreshold);
      setKeyword(initialMonitor.keyword || '');
      setKeywordMatchType(initialMonitor.keywordMatchType || 'CONTAINS');
      setBody(initialMonitor.body || '');
      setFollowRedirects(initialMonitor.followRedirects);
      const entries = Object.entries(initialMonitor.headers || {}).map(([key, value]) => ({
        key,
        value,
      }));
      setHeaderPairs(entries);
    } else {
      setName('');
      setUrl('https://');
      setMethod('GET');
      setStatusCodesText('200, 201, 202, 204');
      setIntervalSeconds(60);
      setTimeoutMs(10000);
      setDegradedThresholdMs(1000);
      setFailureThreshold(2);
      setRecoveryThreshold(2);
      setKeyword('');
      setKeywordMatchType('CONTAINS');
      setBody('');
      setFollowRedirects(true);
      setHeaderPairs([]);
    }
    setError(null);
  }, [initialMonitor, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const expectedStatusCodes = statusCodesText
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 100 && n <= 599);

      if (expectedStatusCodes.length === 0) {
        throw new Error('Provide at least one valid HTTP status code (100-599)');
      }

      const headers: Record<string, string> = {};
      for (const pair of headerPairs) {
        if (pair.key.trim()) {
          headers[pair.key.trim()] = pair.value;
        }
      }

      const payload = {
        name: name.trim(),
        url: url.trim(),
        method,
        headers,
        body: method === 'POST' && body.trim() ? body : null,
        expectedStatusCodes,
        intervalSeconds: Number(intervalSeconds),
        timeoutMs: Number(timeoutMs),
        degradedThresholdMs: Number(degradedThresholdMs),
        failureThreshold: Number(failureThreshold),
        recoveryThreshold: Number(recoveryThreshold),
        keyword: keyword.trim() || null,
        keywordMatchType: keyword.trim() ? keywordMatchType : null,
        followRedirects,
      };

      const path = isEditing
        ? `/projects/${projectId}/monitors/${initialMonitor!.id}`
        : `/projects/${projectId}/monitors`;

      return apiFetch<{ monitor: MonitorRecord }>(path, {
        method: isEditing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitors', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-overview', projectId] });
      if (initialMonitor) {
        queryClient.invalidateQueries({ queryKey: ['monitor', projectId, initialMonitor.id] });
      }
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err instanceof ApiClientError ? err.message : err.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Monitor' : 'Create HTTP/HTTPS Monitor'}</DialogTitle>
          <DialogDescription>
            Configure endpoint URL, assertions, check interval, and incident thresholds. Private and
            loopback IPs are automatically blocked for SSRF protection.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-[8px] border border-pw-red/25 bg-pw-red-bg px-3 py-2.5 text-[11.5px] text-pw-red">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label>Monitor Name</Label>
              <Input
                placeholder="Production API"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>HTTP Method</Label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'GET' | 'POST' | 'HEAD')}
                className="flex h-9 w-full rounded-[8px] border border-pw-border bg-white px-3 text-[12px]"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="HEAD">HEAD</option>
              </select>
            </div>
          </div>

          <div>
            <Label>Target URL (HTTP / HTTPS)</Label>
            <Input
              placeholder="https://api.example.com/health"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>

          {method === 'POST' && (
            <div>
              <Label>Request Body (JSON or text)</Label>
              <Textarea
                placeholder='{"ping": true}'
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-mono text-[11px]"
              />
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Interval</Label>
              <select
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className="flex h-9 w-full rounded-[8px] border border-pw-border bg-white px-2.5 text-[12px]"
              >
                <option value={15}>Every 15s</option>
                <option value={30}>Every 30s</option>
                <option value={60}>Every 1m</option>
                <option value={120}>Every 2m</option>
                <option value={300}>Every 5m</option>
                <option value={600}>Every 10m</option>
              </select>
            </div>
            <div>
              <Label>Timeout (ms)</Label>
              <Input
                type="number"
                min={1000}
                max={30000}
                step={500}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Degraded &gt; (ms)</Label>
              <Input
                type="number"
                min={100}
                max={30000}
                step={100}
                value={degradedThresholdMs}
                onChange={(e) => setDegradedThresholdMs(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Expected Codes</Label>
              <Input
                placeholder="200, 204"
                value={statusCodesText}
                onChange={(e) => setStatusCodesText(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Failure Threshold (checks)</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={failureThreshold}
                onChange={(e) => setFailureThreshold(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Recovery Threshold (checks)</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={recoveryThreshold}
                onChange={(e) => setRecoveryThreshold(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-[11.5px] font-medium text-pw-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={followRedirects}
                  onChange={(e) => setFollowRedirects(e.target.checked)}
                  className="rounded border-pw-border accent-pw-primary"
                />
                Follow redirects (SSRF-checked)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label>Keyword Validation (optional)</Label>
              <Input
                placeholder='e.g. "status":"ok"'
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div>
              <Label>Keyword Rule</Label>
              <select
                value={keywordMatchType}
                onChange={(e) =>
                  setKeywordMatchType(e.target.value as 'CONTAINS' | 'NOT_CONTAINS')
                }
                className="flex h-9 w-full rounded-[8px] border border-pw-border bg-white px-2.5 text-[12px]"
              >
                <option value="CONTAINS">Must contain</option>
                <option value="NOT_CONTAINS">Must NOT contain</option>
              </select>
            </div>
          </div>

          {/* Custom Request Headers */}
          <div className="border-t border-pw-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="mb-0">Custom Request Headers</Label>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => setHeaderPairs([...headerPairs, { key: '', value: '' }])}
              >
                <Plus className="h-3 w-3" /> Add Header
              </Button>
            </div>
            {headerPairs.length === 0 ? (
              <p className="text-[10.5px] text-pw-muted">No custom headers configured.</p>
            ) : (
              <div className="space-y-2">
                {headerPairs.map((pair, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder="Authorization / X-Api-Key"
                      value={pair.key}
                      onChange={(e) => {
                        const copy = [...headerPairs];
                        copy[idx] = { ...copy[idx], key: e.target.value };
                        setHeaderPairs(copy);
                      }}
                      className="h-8 text-[11px]"
                    />
                    <Input
                      placeholder="Header value"
                      value={pair.value}
                      onChange={(e) => {
                        const copy = [...headerPairs];
                        copy[idx] = { ...copy[idx], value: e.target.value };
                        setHeaderPairs(copy);
                      }}
                      className="h-8 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => setHeaderPairs(headerPairs.filter((_, i) => i !== idx))}
                      className="p-1.5 text-pw-muted hover:text-pw-red"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-pw-border">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Saving...'
                : isEditing
                  ? 'Save Changes'
                  : 'Create Monitor'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { format } from 'date-fns';

export interface LatencySeriesPoint {
  timestamp: string;
  avgMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  checks: number;
}

interface ResponseTimeChartProps {
  series: LatencySeriesPoint[];
  avgResponseTimeMs: number | null;
  range: '24h' | '7d' | '30d';
  onRangeChange: (range: '24h' | '7d' | '30d') => void;
  isLoading?: boolean;
}

export function ResponseTimeChart({
  series,
  avgResponseTimeMs,
  range,
  onRangeChange,
  isLoading,
}: ResponseTimeChartProps) {
  const formatted = series.map((pt) => ({
    ...pt,
    label: format(
      new Date(pt.timestamp),
      range === '24h' ? 'h a' : range === '7d' ? 'EEE HH:mm' : 'MMM d',
    ),
  }));

  return (
    <section className="rounded-pw border border-pw-border bg-white p-5 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-bold text-pw-text">Response Time</h3>
          <p className="text-[10.5px] text-pw-muted mt-1">
            Average response time across all monitors
          </p>
        </div>

        <select
          value={range}
          onChange={(e) => onRangeChange(e.target.value as '24h' | '7d' | '30d')}
          className="rounded-[8px] border border-pw-border bg-white px-3 py-1.5 text-[11px] font-semibold text-pw-subtle outline-none hover:bg-pw-bg cursor-pointer"
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      <div className="mt-5 flex items-center justify-between text-[10.5px] text-pw-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-[7px] w-[7px] rounded-full bg-pw-primary" />
          Response time
        </span>
        <strong className="text-pw-text">
          {avgResponseTimeMs !== null ? `${avgResponseTimeMs} ms average` : 'No checks yet'}
        </strong>
      </div>

      <div className="mt-4 h-[230px] w-full">
        {isLoading ? (
          <div className="h-full grid place-items-center text-[11.5px] text-pw-muted">
            Loading telemetry...
          </div>
        ) : formatted.length === 0 ? (
          <div className="h-full grid place-items-center rounded-[8px] border border-dashed border-pw-border text-[11.5px] text-pw-muted px-4 text-center">
            No response-time samples recorded in this window yet. Add a monitor or trigger a check
            to populate live chart data.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formatted} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="pwOverviewFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8064ed" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#8064ed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#ebebf1" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9.5, fill: '#9295a8' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                unit="ms"
                tick={{ fontSize: 9.5, fill: '#9295a8' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#e9eaf0',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
              />
              <Area
                type="monotone"
                dataKey="avgMs"
                name="Avg latency (ms)"
                stroke="#8064ed"
                strokeWidth={2.75}
                fill="url(#pwOverviewFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

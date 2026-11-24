import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon: ReactNode;
  accent: 'purple' | 'blue' | 'green' | 'red';
  trendText?: string;
  trendTone?: 'positive' | 'negative' | 'neutral';
  subtext?: string;
}

const ACCENT_MAP: Record<MetricCardProps['accent'], string> = {
  purple: 'bg-pw-primary-light text-pw-primary',
  blue: 'bg-pw-blue-bg text-pw-blue',
  green: 'bg-pw-green-bg text-pw-green',
  red: 'bg-pw-red-bg text-pw-red',
};

const TONE_MAP: Record<NonNullable<MetricCardProps['trendTone']>, string> = {
  positive: 'text-pw-green font-bold',
  negative: 'text-pw-red font-semibold',
  neutral: 'text-pw-blue font-semibold',
};

export function MetricCard({
  label,
  value,
  unit,
  icon,
  accent,
  trendText,
  trendTone = 'neutral',
  subtext,
}: MetricCardProps) {
  return (
    <div className="rounded-pw border border-pw-border bg-white p-5">
      <div className="flex items-center justify-between text-[11px] font-medium text-[#85879a]">
        <span>{label}</span>
        <span
          className={cn(
            'grid h-[33px] w-[33px] place-items-center rounded-[9px]',
            ACCENT_MAP[accent],
          )}
        >
          {icon}
        </span>
      </div>

      <h2 className="my-4 mb-2.5 text-[27px] font-bold tracking-[-1px] text-pw-text leading-none">
        {value}
        {unit && (
          <small className="ml-1 text-[13px] font-medium text-pw-muted tracking-normal">
            {unit}
          </small>
        )}
      </h2>

      <div className="flex flex-wrap items-center gap-[7px] text-[10px] text-pw-muted">
        {trendText && <span className={TONE_MAP[trendTone]}>{trendText}</span>}
        {subtext && <span>{subtext}</span>}
      </div>
    </div>
  );
}

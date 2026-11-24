import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNowStrict, format } from 'date-fns';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(isoDate?: string | Date | null): string {
  if (!isoDate) return 'Never';
  try {
    const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

export function formatDateTime(isoDate?: string | Date | null): string {
  if (!isoDate) return '—';
  try {
    const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
    return format(d, 'MMM d, yyyy · HH:mm:ss');
  } catch {
    return '—';
  }
}

export function formatUptime(pct?: number | null): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  if (pct === 100) return '100%';
  return `${pct.toFixed(2)}%`;
}

export function getInitials(name?: string | null): string {
  if (!name) return 'PW';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function extractHostname(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

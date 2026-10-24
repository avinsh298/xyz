import {
  HealthResponse,
  DayAheadResponse,
  AccuracyAnalyticsResponse,
} from './types';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function fetchDayAheadSchedule(params: {
  decision_date: string;
  cutoff_time_utc: string;
  resolution: '30min' | '60min';
  confidence_level: 'p50' | 'p90' | 'p95';
  base_demand_mw: number;
}): Promise<DayAheadResponse> {
  const qs = new URLSearchParams({
    decision_date: params.decision_date,
    cutoff_time_utc: params.cutoff_time_utc,
    resolution: params.resolution,
    confidence_level: params.confidence_level,
    base_demand_mw: String(params.base_demand_mw),
  });
  const res = await fetch(`${API_BASE}/day-ahead/schedule?${qs.toString()}`);
  if (!res.ok) throw new Error(`Day-ahead schedule failed: ${res.status}`);
  return res.json();
}

export async function fetchAccuracyAnalytics(params: {
  start_date: string;
  end_date: string;
  target_horizon_hours: number;
  resolution: '30min' | '60min';
}): Promise<AccuracyAnalyticsResponse> {
  const qs = new URLSearchParams({
    start_date: params.start_date,
    end_date: params.end_date,
    target_horizon_hours: String(params.target_horizon_hours),
    resolution: params.resolution,
  });
  const res = await fetch(`${API_BASE}/analytics/accuracy?${qs.toString()}`);
  if (!res.ok) throw new Error(`Accuracy analytics failed: ${res.status}`);
  return res.json();
}
export interface HealthResponse {
  status: string;
  actuals_count: number;
  forecasts_raw_count: number;
  forecasts_valid_count: number;
  backcast_rows_filtered: number;
  date_range_start: string;
  date_range_end: string;
  cache_loaded: boolean;
}

export interface DayAheadPoint {
  start_time: string;
  settlement_date: string;
  settlement_period: number;
  actual_mw: number | null;
  forecast_mw: number | null;
  prev_forecast_mw: number | null;
  revision_delta_mw: number | null;
  publish_time: string | null;
  horizon_hours: number | null;
  error_mw: number | null;
  abs_error_mw: number | null;
  p10_band_mw: number | null;
  p50_band_mw: number | null;
  p90_band_mw: number | null;
  safe_wind_mw: number | null;
  demand_mw: number;
  recommended_thermal_mw: number | null;
  naive_thermal_mw: number | null;
  actual_thermal_needed_mw: number | null;
  unhedged_shortfall_mw: number | null;
}

export interface DayAheadSummary {
  decision_date: string;
  delivery_date: string;
  cutoff_timestamp_utc: string;
  confidence_level: string;
  resolution: string;
  total_demand_mwh: number;
  forecast_wind_mwh: number;
  safe_wind_mwh: number;
  actual_wind_mwh: number;
  naive_thermal_mwh: number;
  recommended_thermal_mwh: number;
  actual_thermal_needed_mwh: number;
  risk_buffer_mwh: number;
  day_mae_mw: number;
  day_rmse_mw: number;
  day_bias_mw: number;
  max_shortfall_mw: number;
  unhedged_shortfall_events: number;
  hedged_shortfall_events: number;
}

export interface DayAheadResponse {
  summary: DayAheadSummary;
  timeseries: DayAheadPoint[];
}

export interface HorizonMetric {
  horizon_bucket: string;
  horizon_min_h: number;
  horizon_max_h: number;
  sample_count: number;
  mae_mw: number;
  rmse_mw: number;
  mape_pct: number;
  bias_mw: number;
  p10_error_mw: number;
  p50_error_mw: number;
  p90_error_mw: number;
  p95_error_mw: number;
}

export interface HourlyHorizonCell {
  hour_of_day: number;
  horizon_bucket: string;
  mae_mw: number;
  bias_mw: number;
  sample_count: number;
}

export interface ErrorHistogramBin {
  bin_start: number;
  bin_end: number;
  bin_center: number;
  count: number;
  frequency_pct: number;
}

export interface HorizonSeriesPoint {
  start_time: string;
  actual_mw: number;
  forecast_mw: number;
  publish_time: string;
  horizon_hours: number;
  error_mw: number;
  abs_error_mw: number;
}

export interface AccuracyAnalyticsResponse {
  start_date: string;
  end_date: string;
  target_horizon_hours: number;
  resolution: string;
  total_evaluated_points: number;
  global_mae_mw: number;
  global_rmse_mw: number;
  global_mape_pct: number;
  normalized_mae_pct: number;
  mean_bias_mw: number;
  p90_overforecast_mw: number;
  p95_overforecast_mw: number;
  overforecast_rate_pct: number;
  horizon_metrics: HorizonMetric[];
  heatmap: HourlyHorizonCell[];
  error_histogram: ErrorHistogramBin[];
  horizon_timeseries: HorizonSeriesPoint[];
}
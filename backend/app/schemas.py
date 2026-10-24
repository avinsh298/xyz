from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    actuals_count: int
    forecasts_raw_count: int
    forecasts_valid_count: int
    backcast_rows_filtered: int
    date_range_start: str
    date_range_end: str
    cache_loaded: bool


class DayAheadPoint(BaseModel):
    start_time: str
    settlement_date: str
    settlement_period: int
    actual_mw: Optional[float]
    forecast_mw: Optional[float]
    prev_forecast_mw: Optional[float]
    revision_delta_mw: Optional[float]
    publish_time: Optional[str]
    horizon_hours: Optional[float]
    error_mw: Optional[float] = Field(
        default=None, description="Forecast - Actual (Positive = Over-forecast / Shortfall risk)"
    )
    abs_error_mw: Optional[float] = None
    p10_band_mw: Optional[float] = None
    p50_band_mw: Optional[float] = None
    p90_band_mw: Optional[float] = None
    safe_wind_mw: Optional[float] = None
    demand_mw: float
    recommended_thermal_mw: Optional[float] = None
    naive_thermal_mw: Optional[float] = None
    actual_thermal_needed_mw: Optional[float] = None
    unhedged_shortfall_mw: Optional[float] = None


class DayAheadSummary(BaseModel):
    decision_date: str
    delivery_date: str
    cutoff_timestamp_utc: str
    confidence_level: str
    resolution: str
    total_demand_mwh: float
    forecast_wind_mwh: float
    safe_wind_mwh: float
    actual_wind_mwh: float
    naive_thermal_mwh: float
    recommended_thermal_mwh: float
    actual_thermal_needed_mwh: float
    risk_buffer_mwh: float
    day_mae_mw: float
    day_rmse_mw: float
    day_bias_mw: float
    max_shortfall_mw: float
    unhedged_shortfall_events: int
    hedged_shortfall_events: int


class DayAheadResponse(BaseModel):
    summary: DayAheadSummary
    timeseries: List[DayAheadPoint]


class HorizonMetric(BaseModel):
    horizon_bucket: str
    horizon_min_h: float
    horizon_max_h: float
    sample_count: int
    mae_mw: float
    rmse_mw: float
    mape_pct: float
    bias_mw: float
    p10_error_mw: float
    p50_error_mw: float
    p90_error_mw: float
    p95_error_mw: float


class HourlyHorizonCell(BaseModel):
    hour_of_day: int
    horizon_bucket: str
    mae_mw: float
    bias_mw: float
    sample_count: int


class ErrorHistogramBin(BaseModel):
    bin_start: float
    bin_end: float
    bin_center: float
    count: int
    frequency_pct: float


class HorizonSeriesPoint(BaseModel):
    start_time: str
    actual_mw: float
    forecast_mw: float
    publish_time: str
    horizon_hours: float
    error_mw: float
    abs_error_mw: float


class AccuracyAnalyticsResponse(BaseModel):
    start_date: str
    end_date: str
    target_horizon_hours: float
    resolution: str
    total_evaluated_points: int
    global_mae_mw: float
    global_rmse_mw: float
    global_mape_pct: float
    normalized_mae_pct: float
    mean_bias_mw: float
    p90_overforecast_mw: float
    p95_overforecast_mw: float
    overforecast_rate_pct: float
    horizon_metrics: List[HorizonMetric]
    heatmap: List[HourlyHorizonCell]
    error_histogram: List[ErrorHistogramBin]
    horizon_timeseries: List[HorizonSeriesPoint]
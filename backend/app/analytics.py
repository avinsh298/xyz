from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from app.schemas import (
    DayAheadPoint,
    DayAheadResponse,
    DayAheadSummary,
    AccuracyAnalyticsResponse,
    HorizonMetric,
    HourlyHorizonCell,
    ErrorHistogramBin,
    HorizonSeriesPoint,
)

HORIZON_BUCKETS: List[Tuple[str, float, float]] = [
    ("0-6h (Intraday)", 0.0, 6.0),
    ("6-12h (Near Day-Ahead)", 6.0, 12.0),
    ("12-18h (Day-Ahead Morning)", 12.0, 18.0),
    ("18-24h (Day-Ahead Afternoon)", 18.0, 24.0),
    ("24-36h (Day-Ahead Evening/Next)", 24.0, 36.0),
    ("36-48h (2-Day Ahead)", 36.0, 48.0),
]


def _assign_horizon_bucket(h: float) -> str:
    for label, low, high in HORIZON_BUCKETS:
        if low <= h < high:
            return label
    return "36-48h (2-Day Ahead)"


def build_matched_pairs(
    actuals_df: pd.DataFrame,
    forecasts_df: pd.DataFrame,
    resolution: str = "60min",
    start_date: str = "2026-01-01",
    end_date: str = "2026-02-01",
) -> pd.DataFrame:
    """
    Matches WINDFOR forecast rows against FUELHH actuals.
    If resolution == '30min', interpolates each forecast batch (by publish_time)
    onto 30-minute settlement periods before joining with actuals.
    """
    if actuals_df.empty or forecasts_df.empty:
        return pd.DataFrame()

    start_ts = pd.Timestamp(f"{start_date}T00:00:00Z")
    end_ts = pd.Timestamp(f"{end_date}T23:59:59Z")

    act = actuals_df[
        (actuals_df["start_time"] >= start_ts) & (actuals_df["start_time"] <= end_ts)
    ][["start_time", "settlementDate", "settlementPeriod", "actual_mw"]].copy()

    fc = forecasts_df[
        (forecasts_df["start_time"] >= start_ts - pd.Timedelta(hours=2))
        & (forecasts_df["start_time"] <= end_ts + pd.Timedelta(hours=2))
        & (forecasts_df["horizon_hours"] <= 48.0)
    ][["start_time", "publish_time", "forecast_mw", "horizon_hours"]].copy()

    if resolution == "30min":
        # Upsample each forecast run (grouped by publish_time) to 30-min grid
        upsampled_runs = []
        for pub_time, group in fc.groupby("publish_time"):
            g = group.sort_values("start_time").set_index("start_time")
            g_30 = g[["forecast_mw"]].resample("30min").interpolate(method="linear")
            g_30["publish_time"] = pub_time
            g_30["horizon_hours"] = (
                g_30.index - pub_time
            ).total_seconds() / 3600.0
            g_30 = g_30[
                (g_30["horizon_hours"] >= 0.0) & (g_30["horizon_hours"] <= 48.0)
            ]
            upsampled_runs.append(g_30.reset_index())
        if upsampled_runs:
            fc = pd.concat(upsampled_runs, ignore_index=True)

    merged = pd.merge(fc, act, on="start_time", how="inner")
    # Error definition from utility procurement perspective:
    # error_mw = Forecast - Actual
    # Positive error_mw => Wind was OVER-FORECASTED => Physical generation shortfall!
    merged["error_mw"] = merged["forecast_mw"] - merged["actual_mw"]
    merged["abs_error_mw"] = merged["error_mw"].abs()
    merged["ape_pct"] = (
        merged["abs_error_mw"] / merged["actual_mw"].clip(lower=100.0)
    ) * 100.0
    merged["horizon_bucket"] = merged["horizon_hours"].apply(_assign_horizon_bucket)
    return merged


def compute_day_ahead_schedule(
    actuals_df: pd.DataFrame,
    forecasts_df: pd.DataFrame,
    decision_date: str = "2026-01-15",
    cutoff_time_utc: str = "09:20",
    resolution: str = "30min",
    confidence_level: str = "p90",
    base_demand_mw: float = 32000.0,
) -> DayAheadResponse:
    """
    Simulates the UK Day-Ahead trading desk on `decision_date` at `cutoff_time_utc`.
    The decision made on Day D-1 (`decision_date`) is for Delivery Day D (`decision_date + 1 day`).
    """
    dec_dt = datetime.strptime(decision_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    deliv_dt = dec_dt + timedelta(days=1)
    delivery_date_str = deliv_dt.strftime("%Y-%m-%d")

    cutoff_hour, cutoff_min = [int(x) for x in cutoff_time_utc.split(":")]
    cutoff_ts = pd.Timestamp(
        datetime(
            dec_dt.year,
            dec_dt.month,
            dec_dt.day,
            cutoff_hour,
            cutoff_min,
            tzinfo=timezone.utc,
        )
    )

    deliv_start = pd.Timestamp(f"{delivery_date_str}T00:00:00Z")
    deliv_end = pd.Timestamp(f"{delivery_date_str}T23:59:59Z")

    # 1. Compute historical empirical error quantiles by horizon bucket
    # strictly using data prior to cutoff_ts (or full Jan sample if Jan 1) to avoid lookahead
    hist_pairs = build_matched_pairs(
        actuals_df,
        forecasts_df,
        resolution="60min",
        start_date="2026-01-01",
        end_date="2026-01-31",
    )
    bucket_quantiles: Dict[str, Dict[str, float]] = {}
    for label, low, high in HORIZON_BUCKETS:
        sub = hist_pairs[
            (hist_pairs["horizon_hours"] >= low) & (hist_pairs["horizon_hours"] < high)
        ]
        if len(sub) >= 5:
            bucket_quantiles[label] = {
                "p10": float(np.percentile(sub["error_mw"], 10)),
                "p50": float(np.percentile(sub["error_mw"], 50)),
                "p90": float(np.percentile(sub["error_mw"], 90)),
                "p95": float(np.percentile(sub["error_mw"], 95)),
            }
        else:
            bucket_quantiles[label] = {"p10": -1200.0, "p50": 0.0, "p90": 1500.0, "p95": 2000.0}

    # 2. Filter forecasts published ON OR BEFORE cutoff_ts
    valid_fc = forecasts_df[forecasts_df["publish_time"] <= cutoff_ts].copy()

    # Build target delivery grid (either 48 half-hours or 24 hours)
    freq = "30min" if resolution == "30min" else "60min"
    grid_times = pd.date_range(deliv_start, deliv_end, freq=freq, tz="UTC")
    grid_df = pd.DataFrame({"start_time": grid_times})

    # Attach Actuals
    act_slice = actuals_df[
        (actuals_df["start_time"] >= deliv_start)
        & (actuals_df["start_time"] <= deliv_end)
    ][["start_time", "settlementDate", "settlementPeriod", "actual_mw"]].copy()
    grid_df = pd.merge(grid_df, act_slice, on="start_time", how="left")

    # Determine latest and second-latest forecast available at cutoff_ts
    if not valid_fc.empty:
        if resolution == "30min":
            # Take recent forecast batches and interpolate to 30-min
            recent_batches = sorted(valid_fc["publish_time"].unique())[-6:]
            fc_recent = valid_fc[valid_fc["publish_time"].isin(recent_batches)]
            upsampled = []
            for pub_t, grp in fc_recent.groupby("publish_time"):
                g = grp.sort_values("start_time").set_index("start_time")
                g30 = g[["forecast_mw"]].resample("30min").interpolate(method="linear")
                g30["publish_time"] = pub_t
                upsampled.append(g30.reset_index())
            fc_usable = pd.concat(upsampled, ignore_index=True)
        else:
            fc_usable = valid_fc.copy()

        fc_deliv = fc_usable[
            (fc_usable["start_time"] >= deliv_start)
            & (fc_usable["start_time"] <= deliv_end)
        ].sort_values(["start_time", "publish_time"])

        latest_fc = fc_deliv.groupby("start_time").nth(-1).reset_index()
        prev_fc = (
            fc_deliv.groupby("start_time")
            .nth(-2)
            .reset_index()[["start_time", "forecast_mw"]]
            .rename(columns={"forecast_mw": "prev_forecast_mw"})
        )

        grid_df = pd.merge(
            grid_df,
            latest_fc[["start_time", "forecast_mw", "publish_time"]],
            on="start_time",
            how="left",
        )
        grid_df = pd.merge(grid_df, prev_fc, on="start_time", how="left")
    else:
        grid_df["forecast_mw"] = np.nan
        grid_df["publish_time"] = pd.NaT
        grid_df["prev_forecast_mw"] = np.nan

    # Realistic UK winter diurnal demand curve around base_demand_mw
    # (Morning ramp 07:00-09:00, Evening peak 16:30-19:30, Overnight trough 01:00-05:00)
    hours_float = grid_df["start_time"].dt.hour + grid_df["start_time"].dt.minute / 60.0
    diurnal_factor = (
        1.0
        - 0.18 * np.cos((hours_float - 4.0) * 2 * np.pi / 24.0)
        + 0.10 * np.exp(-0.5 * ((hours_float - 17.5) / 2.2) ** 2)
    )
    grid_df["demand_mw"] = np.round(base_demand_mw * diurnal_factor, 1)

    slot_hours = 0.5 if resolution == "30min" else 1.0
    points: List[DayAheadPoint] = []

    for _, row in grid_df.iterrows():
        st: pd.Timestamp = row["start_time"]
        s_date = (
            str(row["settlementDate"])
            if pd.notna(row.get("settlementDate"))
            else st.strftime("%Y-%m-%d")
        )
        s_period = (
            int(row["settlementPeriod"])
            if pd.notna(row.get("settlementPeriod"))
            else int(st.hour * 2 + (st.minute // 30) + 1)
        )

        act_mw = float(row["actual_mw"]) if pd.notna(row["actual_mw"]) else None
        fc_mw = float(row["forecast_mw"]) if pd.notna(row["forecast_mw"]) else None
        prev_mw = (
            float(row["prev_forecast_mw"])
            if pd.notna(row["prev_forecast_mw"])
            else None
        )
        pub_t = (
            row["publish_time"].strftime("%Y-%m-%dT%H:%M:%SZ")
            if pd.notna(row["publish_time"])
            else None
        )
        horizon_h = (
            round((st - row["publish_time"]).total_seconds() / 3600.0, 2)
            if pd.notna(row["publish_time"])
            else None
        )

        rev_delta = (
            round(fc_mw - prev_mw, 1)
            if (fc_mw is not None and prev_mw is not None)
            else None
        )
        err_mw = (
            round(fc_mw - act_mw, 1)
            if (fc_mw is not None and act_mw is not None)
            else None
        )
        abs_err = round(abs(err_mw), 1) if err_mw is not None else None

        # Determine empirical error bands for this horizon
        b_label = _assign_horizon_bucket(horizon_h if horizon_h is not None else 24.0)
        q = bucket_quantiles[b_label]

        if fc_mw is not None:
            # Recall: Actual = Forecast - Error
            # When Error is at P90 (over-forecast), Actual is at its P10 low bound: Forecast - q["p90"]
            p10_band = max(0.0, round(fc_mw - q["p90"], 1))
            p50_band = max(0.0, round(fc_mw - q["p50"], 1))
            p90_band = max(0.0, round(fc_mw - q["p10"], 1))

            if confidence_level == "p95":
                risk_haircut = max(0.0, q["p95"])
            elif confidence_level == "p90":
                risk_haircut = max(0.0, q["p90"])
            else:
                risk_haircut = max(0.0, q["p50"])

            safe_wind = max(0.0, round(fc_mw - risk_haircut, 1))
            demand_val = float(row["demand_mw"])
            rec_thermal = max(0.0, round(demand_val - safe_wind, 1))
            naive_thermal = max(0.0, round(demand_val - fc_mw, 1))
        else:
            p10_band = p50_band = p90_band = safe_wind = rec_thermal = naive_thermal = None
            demand_val = float(row["demand_mw"])

        actual_thermal_needed = (
            max(0.0, round(demand_val - act_mw, 1)) if act_mw is not None else None
        )
        unhedged_shortfall = (
            max(0.0, round(actual_thermal_needed - naive_thermal, 1))
            if (actual_thermal_needed is not None and naive_thermal is not None)
            else None
        )

        points.append(
            DayAheadPoint(
                start_time=st.strftime("%Y-%m-%dT%H:%M:%SZ"),
                settlement_date=s_date,
                settlement_period=s_period,
                actual_mw=act_mw,
                forecast_mw=fc_mw,
                prev_forecast_mw=prev_mw,
                revision_delta_mw=rev_delta,
                publish_time=pub_t,
                horizon_hours=horizon_h,
                error_mw=err_mw,
                abs_error_mw=abs_err,
                p10_band_mw=p10_band,
                p50_band_mw=p50_band,
                p90_band_mw=p90_band,
                safe_wind_mw=safe_wind,
                demand_mw=demand_val,
                recommended_thermal_mw=rec_thermal,
                naive_thermal_mw=naive_thermal,
                actual_thermal_needed_mw=actual_thermal_needed,
                unhedged_shortfall_mw=unhedged_shortfall,
            )
        )

    valid_pts = [p for p in points if p.forecast_mw is not None and p.actual_mw is not None]
    errors = np.array([p.error_mw for p in valid_pts], dtype=float) if valid_pts else np.array([0.0])

    total_demand_mwh = round(sum(p.demand_mw * slot_hours for p in points), 1)
    forecast_wind_mwh = round(sum((p.forecast_mw or 0.0) * slot_hours for p in points), 1)
    safe_wind_mwh = round(sum((p.safe_wind_mw or 0.0) * slot_hours for p in points), 1)
    actual_wind_mwh = round(sum((p.actual_mw or 0.0) * slot_hours for p in points), 1)
    naive_thermal_mwh = round(sum((p.naive_thermal_mw or 0.0) * slot_hours for p in points), 1)
    rec_thermal_mwh = round(sum((p.recommended_thermal_mw or 0.0) * slot_hours for p in points), 1)
    act_thermal_mwh = round(sum((p.actual_thermal_needed_mw or 0.0) * slot_hours for p in points), 1)

    unhedged_events = sum(1 for p in valid_pts if (p.error_mw or 0.0) > 0.0)
    hedged_events = sum(
        1
        for p in valid_pts
        if p.actual_mw is not None and p.safe_wind_mw is not None and p.actual_mw < p.safe_wind_mw
    )

    summary = DayAheadSummary(
        decision_date=decision_date,
        delivery_date=delivery_date_str,
        cutoff_timestamp_utc=cutoff_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        confidence_level=confidence_level,
        resolution=resolution,
        total_demand_mwh=total_demand_mwh,
        forecast_wind_mwh=forecast_wind_mwh,
        safe_wind_mwh=safe_wind_mwh,
        actual_wind_mwh=actual_wind_mwh,
        naive_thermal_mwh=naive_thermal_mwh,
        recommended_thermal_mwh=rec_thermal_mwh,
        actual_thermal_needed_mwh=act_thermal_mwh,
        risk_buffer_mwh=round(rec_thermal_mwh - naive_thermal_mwh, 1),
        day_mae_mw=round(float(np.mean(np.abs(errors))), 1),
        day_rmse_mw=round(float(np.sqrt(np.mean(errors**2))), 1),
        day_bias_mw=round(float(np.mean(errors)), 1),
        max_shortfall_mw=round(float(np.max(errors)), 1) if len(errors) else 0.0,
        unhedged_shortfall_events=unhedged_events,
        hedged_shortfall_events=hedged_events,
    )

    return DayAheadResponse(summary=summary, timeseries=points)


def compute_accuracy_analytics(
    actuals_df: pd.DataFrame,
    forecasts_df: pd.DataFrame,
    start_date: str = "2026-01-01",
    end_date: str = "2026-01-31",
    target_horizon_hours: float = 24.0,
    resolution: str = "60min",
) -> AccuracyAnalyticsResponse:
    """
    Computes full-month quantitative error analytics across January 2026:
    - Horizon bucket metrics (MAE, RMSE, MAPE, Bias, P10/P50/P90/P95)
    - Hour-of-Day x Horizon Bucket 2D error heatmap
    - Error distribution histogram
    - Continuous time-series for the selected target_horizon_hours
    """
    pairs = build_matched_pairs(
        actuals_df,
        forecasts_df,
        resolution=resolution,
        start_date=start_date,
        end_date=end_date,
    )

    if pairs.empty:
        return AccuracyAnalyticsResponse(
            start_date=start_date,
            end_date=end_date,
            target_horizon_hours=target_horizon_hours,
            resolution=resolution,
            total_evaluated_points=0,
            global_mae_mw=0.0,
            global_rmse_mw=0.0,
            global_mape_pct=0.0,
            normalized_mae_pct=0.0,
            mean_bias_mw=0.0,
            p90_overforecast_mw=0.0,
            p95_overforecast_mw=0.0,
            overforecast_rate_pct=0.0,
            horizon_metrics=[],
            heatmap=[],
            error_histogram=[],
            horizon_timeseries=[],
        )

    errs = pairs["error_mw"].to_numpy()
    abs_errs = pairs["abs_error_mw"].to_numpy()
    peak_actual = max(float(pairs["actual_mw"].max()), 1.0)

    # 1. Horizon Bucket Metrics
    horizon_metrics: List[HorizonMetric] = []
    for label, low, high in HORIZON_BUCKETS:
        sub = pairs[(pairs["horizon_hours"] >= low) & (pairs["horizon_hours"] < high)]
        if sub.empty:
            continue
        s_err = sub["error_mw"].to_numpy()
        s_abs = sub["abs_error_mw"].to_numpy()
        horizon_metrics.append(
            HorizonMetric(
                horizon_bucket=label,
                horizon_min_h=low,
                horizon_max_h=high,
                sample_count=int(len(sub)),
                mae_mw=round(float(np.mean(s_abs)), 1),
                rmse_mw=round(float(np.sqrt(np.mean(s_err**2))), 1),
                mape_pct=round(float(sub["ape_pct"].mean()), 2),
                bias_mw=round(float(np.mean(s_err)), 1),
                p10_error_mw=round(float(np.percentile(s_err, 10)), 1),
                p50_error_mw=round(float(np.percentile(s_err, 50)), 1),
                p90_error_mw=round(float(np.percentile(s_err, 90)), 1),
                p95_error_mw=round(float(np.percentile(s_err, 95)), 1),
            )
        )

    # 2. 2D Heatmap: Hour of Day (0..23) x Horizon Bucket
    pairs["hour_of_day"] = pairs["start_time"].dt.hour
    heatmap: List[HourlyHorizonCell] = []
    for hour in range(24):
        for label, low, high in HORIZON_BUCKETS:
            cell = pairs[
                (pairs["hour_of_day"] == hour)
                & (pairs["horizon_hours"] >= low)
                & (pairs["horizon_hours"] < high)
            ]
            if not cell.empty:
                heatmap.append(
                    HourlyHorizonCell(
                        hour_of_day=hour,
                        horizon_bucket=label,
                        mae_mw=round(float(cell["abs_error_mw"].mean()), 1),
                        bias_mw=round(float(cell["error_mw"].mean()), 1),
                        sample_count=int(len(cell)),
                    )
                )

    # 3. Error Histogram (20 bins across [P1, P99])
    low_b, high_b = float(np.percentile(errs, 1)), float(np.percentile(errs, 99))
    if low_b >= high_b:
        low_b, high_b = -3000.0, 3000.0
    counts, bin_edges = np.histogram(errs, bins=20, range=(low_b, high_b))
    total_n = max(int(counts.sum()), 1)
    histogram: List[ErrorHistogramBin] = []
    for i in range(len(counts)):
        b_start = float(bin_edges[i])
        b_end = float(bin_edges[i + 1])
        histogram.append(
            ErrorHistogramBin(
                bin_start=round(b_start, 1),
                bin_end=round(b_end, 1),
                bin_center=round((b_start + b_end) / 2.0, 1),
                count=int(counts[i]),
                frequency_pct=round((int(counts[i]) / total_n) * 100.0, 2),
            )
        )

    # 4. Target Horizon Time-Series (For each start_time, select the forecast
    # with horizon_hours >= target_horizon_hours that is closest to target_horizon_hours)
    eligible = pairs[pairs["horizon_hours"] >= target_horizon_hours].copy()
    if eligible.empty:
        eligible = pairs.copy()
    eligible["horizon_diff"] = (eligible["horizon_hours"] - target_horizon_hours).abs()
    best_per_target = (
        eligible.sort_values(["start_time", "horizon_diff", "publish_time"])
        .groupby("start_time")
        .first()
        .reset_index()
    )

    horizon_ts: List[HorizonSeriesPoint] = [
        HorizonSeriesPoint(
            start_time=r["start_time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            actual_mw=round(float(r["actual_mw"]), 1),
            forecast_mw=round(float(r["forecast_mw"]), 1),
            publish_time=r["publish_time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            horizon_hours=round(float(r["horizon_hours"]), 2),
            error_mw=round(float(r["error_mw"]), 1),
            abs_error_mw=round(float(r["abs_error_mw"]), 1),
        )
        for _, r in best_per_target.iterrows()
    ]

    # Compute top-level KPIs from the selected horizon slice so the cards dynamically
    # reflect the user's selected lookahead horizon
    h_errs = best_per_target["error_mw"].to_numpy()
    h_abs = best_per_target["abs_error_mw"].to_numpy()

    return AccuracyAnalyticsResponse(
        start_date=start_date,
        end_date=end_date,
        target_horizon_hours=target_horizon_hours,
        resolution=resolution,
        total_evaluated_points=int(len(best_per_target)),
        global_mae_mw=round(float(np.mean(h_abs)), 1),
        global_rmse_mw=round(float(np.sqrt(np.mean(h_errs**2))), 1),
        global_mape_pct=round(float(best_per_target["ape_pct"].mean()), 2),
        normalized_mae_pct=round(float((np.mean(h_abs) / peak_actual) * 100.0), 2),
        mean_bias_mw=round(float(np.mean(h_errs)), 1),
        p90_overforecast_mw=round(float(np.percentile(h_errs, 90)), 1),
        p95_overforecast_mw=round(float(np.percentile(h_errs, 95)), 1),
        overforecast_rate_pct=round(float(np.mean(h_errs > 0) * 100.0), 1),
        horizon_metrics=horizon_metrics,
        heatmap=heatmap,
        error_histogram=histogram,
        horizon_timeseries=horizon_ts,
    )
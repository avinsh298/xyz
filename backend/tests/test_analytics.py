import pytest
from app.data_store import ElexonDataStore
from app.analytics import compute_day_ahead_schedule, compute_accuracy_analytics


def _build_synthetic_store(include_post_cutoff_spike: bool = False) -> ElexonDataStore:
    store = ElexonDataStore()
    raw_actuals = [
        {
            "startTime": f"2026-01-16T{h:02d}:00:00Z",
            "settlementDate": "2026-01-16",
            "settlementPeriod": h * 2 + 1,
            "fuelType": "WIND",
            "generation": 10000 + h * 100,
        }
        for h in range(24)
    ]
    raw_forecasts = []
    for h in range(24):
        target_iso = f"2026-01-16T{h:02d}:00:00Z"
        # 1. Valid baseline forecast published >= 24h before all Jan 16 delivery slots
        raw_forecasts.append(
            {
                "startTime": target_iso,
                "publishTime": "2026-01-14T23:00:00Z",
                "generation": 10800 + h * 100,
            }
        )
        # 2. Valid morning forecast published BEFORE 09:20 UTC on Jan 15 (08:00 UTC)
        raw_forecasts.append(
            {
                "startTime": target_iso,
                "publishTime": "2026-01-15T08:00:00Z",
                "generation": 11000 + h * 100,  # +1000 MW over-forecast
            }
        )
        if include_post_cutoff_spike:
            # 3. Forecast published AFTER 09:20 UTC cutoff (14:00 UTC) -> MUST NOT LEAK into 09:20 decision!
            raw_forecasts.append(
                {
                    "startTime": target_iso,
                    "publishTime": "2026-01-15T14:00:00Z",
                    "generation": 99999,
                }
            )
        # 4. Invalid backcast row where publishTime > startTime -> MUST BE FILTERED OUT!
        raw_forecasts.append(
            {
                "startTime": target_iso,
                "publishTime": "2026-01-17T12:00:00Z",
                "generation": 88888,
            }
        )
    store._process_datasets(raw_actuals, raw_forecasts)
    return store


def test_negative_horizon_backcasts_filtered():
    store = _build_synthetic_store(include_post_cutoff_spike=True)
    assert store.backcast_rows_filtered == 24
    assert (store.forecasts_df["horizon_hours"] >= 0.0).all()


def test_zero_lookahead_leakage_at_gate_closure():
    store = _build_synthetic_store(include_post_cutoff_spike=True)
    res = compute_day_ahead_schedule(
        actuals_df=store.actuals_df,
        forecasts_df=store.forecasts_df,
        decision_date="2026-01-15",
        cutoff_time_utc="09:20",
        resolution="60min",
        confidence_level="p90",
        base_demand_mw=30000.0,
    )
    # Every forecast used must come from the 08:00Z run, never the 14:00Z (99999 MW) run
    for pt in res.timeseries:
        assert pt.publish_time == "2026-01-15T08:00:00Z"
        assert pt.forecast_mw < 20000
        assert pt.error_mw == pytest.approx(1000.0)


def test_jan31_decision_evaluates_feb1_delivery():
    store = _build_synthetic_store()
    res = compute_day_ahead_schedule(
        actuals_df=store.actuals_df,
        forecasts_df=store.forecasts_df,
        decision_date="2026-01-31",
        cutoff_time_utc="09:20",
        resolution="30min",
    )
    assert res.summary.decision_date == "2026-01-31"
    assert res.summary.delivery_date == "2026-02-01"
    assert len(res.timeseries) == 48


def test_accuracy_metrics_calculation():
    store = _build_synthetic_store(include_post_cutoff_spike=False)
    acc = compute_accuracy_analytics(
        actuals_df=store.actuals_df,
        forecasts_df=store.forecasts_df,
        start_date="2026-01-01",
        end_date="2026-01-31",
        target_horizon_hours=16.0,
        resolution="60min",
    )
    assert acc.total_evaluated_points == 24
    assert acc.global_mae_mw == pytest.approx(1000.0)
    assert acc.mean_bias_mw == pytest.approx(1000.0)
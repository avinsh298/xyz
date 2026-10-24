import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.data_store import data_store
from app.schemas import HealthResponse, DayAheadResponse, AccuracyAnalyticsResponse
from app.analytics import compute_day_ahead_schedule, compute_accuracy_analytics

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)


async def ensure_store_ready() -> None:
    if not data_store.is_loaded or data_store.actuals_df.empty:
        await data_store.initialize(force_refresh=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_store_ready()
    yield


app = FastAPI(
    title="GridPulse UK — Day-Ahead Wind & Thermal Procurement Intelligence API",
    version="1.0.0",
    description=(
        "Quantitative decision-support API for UK Day-Ahead electricity market traders. "
        "Ingests Elexon BMRS FUELHH & WINDFOR streams for January 2026 decisions."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    await ensure_store_ready()
    if not data_store.is_loaded or data_store.actuals_df.empty:
        raise HTTPException(status_code=503, detail="Dataset still initializing")
    return HealthResponse(
        status="healthy",
        actuals_count=len(data_store.actuals_df),
        forecasts_raw_count=data_store.forecasts_raw_count,
        forecasts_valid_count=len(data_store.forecasts_df),
        backcast_rows_filtered=data_store.backcast_rows_filtered,
        date_range_start=data_store.actuals_df["start_time"].min().strftime("%Y-%m-%dT%H:%M:%SZ"),
        date_range_end=data_store.actuals_df["start_time"].max().strftime("%Y-%m-%dT%H:%M:%SZ"),
        cache_loaded=data_store.is_loaded,
    )


@app.get("/api/v1/day-ahead/schedule", response_model=DayAheadResponse)
async def get_day_ahead_schedule(
    decision_date: str = Query(
        "2026-01-15",
        pattern=r"^2026-01-(0[1-9]|[12][0-9]|3[01])$",
        description="Date in January 2026 when the Day-Ahead purchase decision is made (D-1)",
    ),
    cutoff_time_utc: str = Query(
        "09:20",
        pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$",
        description="Market gate-closure decision cutoff time in UTC on decision_date",
    ),
    resolution: str = Query(
        "30min",
        pattern=r"^(30min|60min)$",
        description="30min (UK Settlement Periods 1-48) or 60min (Exact WINDFOR native resolution)",
    ),
    confidence_level: str = Query(
        "p90",
        pattern=r"^(p50|p90|p95)$",
        description="Confidence level for safe wind & thermal reserve calculation",
    ),
    base_demand_mw: float = Query(
        32000.0,
        ge=5000.0,
        le=60000.0,
        description="Baseline consumer demand level in MW",
    ),
) -> DayAheadResponse:
    await ensure_store_ready()
    return compute_day_ahead_schedule(
        actuals_df=data_store.actuals_df,
        forecasts_df=data_store.forecasts_df,
        decision_date=decision_date,
        cutoff_time_utc=cutoff_time_utc,
        resolution=resolution,
        confidence_level=confidence_level,
        base_demand_mw=base_demand_mw,
    )


@app.get("/api/v1/analytics/accuracy", response_model=AccuracyAnalyticsResponse)
async def get_accuracy_analytics(
    start_date: str = Query("2026-01-01", pattern=r"^2026-01-(0[1-9]|[12][0-9]|3[01])$"),
    end_date: str = Query("2026-01-31", pattern=r"^2026-(01-(0[1-9]|[12][0-9]|3[01])|02-0[12])$"),
    target_horizon_hours: float = Query(24.0, ge=1.0, le=48.0),
    resolution: str = Query("60min", pattern=r"^(30min|60min)$"),
) -> AccuracyAnalyticsResponse:
    await ensure_store_ready()
    return compute_accuracy_analytics(
        actuals_df=data_store.actuals_df,
        forecasts_df=data_store.forecasts_df,
        start_date=start_date,
        end_date=end_date,
        target_horizon_hours=target_horizon_hours,
        resolution=resolution,
    )

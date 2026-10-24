import json
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple
import httpx
import pandas as pd
import numpy as np

logger = logging.getLogger("wind_copilot.datastore")

CACHE_DIR = Path(__file__).resolve().parent.parent / "data_cache"
ACTUALS_CACHE_FILE = CACHE_DIR / "fuelhh_wind_jan2026.json"
FORECASTS_CACHE_FILE = CACHE_DIR / "windfor_jan2026.json"

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"


class ElexonDataStore:
    """
    Manages ingestion, sanitization, and in-memory vectorized indexing for Elexon
    FUELHH (WIND actuals) and WINDFOR (wind generation forecasts) covering all
    Day-Ahead purchase decisions made in January 2026.
    """

    def __init__(self) -> None:
        self.actuals_df: pd.DataFrame = pd.DataFrame()
        self.forecasts_df: pd.DataFrame = pd.DataFrame()
        self.forecasts_raw_count: int = 0
        self.backcast_rows_filtered: int = 0
        self.is_loaded: bool = False

    async def initialize(self, force_refresh: bool = False) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        if (
            not force_refresh
            and ACTUALS_CACHE_FILE.exists()
            and FORECASTS_CACHE_FILE.exists()
        ):
            logger.info("Loading Elexon datasets from local disk cache...")
            raw_actuals = json.loads(ACTUALS_CACHE_FILE.read_text())
            raw_forecasts = json.loads(FORECASTS_CACHE_FILE.read_text())
        else:
            logger.info("Fetching fresh Elexon BMRS datasets for Jan 2026 decisions...")
            raw_actuals, raw_forecasts = await self._fetch_from_elexon()
            ACTUALS_CACHE_FILE.write_text(json.dumps(raw_actuals))
            FORECASTS_CACHE_FILE.write_text(json.dumps(raw_forecasts))

        self._process_datasets(raw_actuals, raw_forecasts)
        self.is_loaded = True
        logger.info(
            f"DataStore ready: {len(self.actuals_df)} actuals, "
            f"{len(self.forecasts_df)} valid forecasts "
            f"({self.backcast_rows_filtered} backcast/out-of-horizon rows removed)."
        )

    async def _fetch_from_elexon(self) -> Tuple[list, list]:
        # Decisions made Jan 1 - Jan 31, 2026 require:
        # - Forecasts published from Dec 29, 2025 through Feb 1, 2026
        # - Actuals delivered from Dec 31, 2025 through Feb 2, 2026
        timeout = httpx.Timeout(45.0, connect=15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. Fetch FUELHH Actuals (WIND)
            actuals_url = f"{ELEXON_BASE_URL}/FUELHH/stream"
            actuals_params = {
                "settlementDateFrom": "2025-12-31",
                "settlementDateTo": "2026-02-02",
                "fuelType": "WIND",
            }
            resp_act = await client.get(actuals_url, params=actuals_params)
            resp_act.raise_for_status()
            raw_actuals = resp_act.json()

            # 2. Fetch WINDFOR in 7-day publish windows to ensure clean streaming
            raw_forecasts = []
            windows = [
                ("2025-12-29T00:00:00Z", "2026-01-05T23:59:59Z"),
                ("2026-01-06T00:00:00Z", "2026-01-13T23:59:59Z"),
                ("2026-01-14T00:00:00Z", "2026-01-21T23:59:59Z"),
                ("2026-01-22T00:00:00Z", "2026-01-29T23:59:59Z"),
                ("2026-01-30T00:00:00Z", "2026-02-02T23:59:59Z"),
            ]
            forecast_url = f"{ELEXON_BASE_URL}/WINDFOR/stream"
            for start_iso, end_iso in windows:
                r = await client.get(
                    forecast_url,
                    params={
                        "publishDateTimeFrom": start_iso,
                        "publishDateTimeTo": end_iso,
                    },
                )
                r.raise_for_status()
                raw_forecasts.extend(r.json())

        return raw_actuals, raw_forecasts

    def _process_datasets(self, raw_actuals: list, raw_forecasts: list) -> None:
        # Process Actuals (FUELHH)
        act_df = pd.DataFrame(raw_actuals)
        if not act_df.empty:
            if "fuelType" in act_df.columns:
                act_df = act_df[act_df["fuelType"] == "WIND"].copy()
            act_df["start_time"] = pd.to_datetime(act_df["startTime"], utc=True)
            act_df["actual_mw"] = pd.to_numeric(act_df["generation"], errors="coerce")
            act_df = (
                act_df.dropna(subset=["start_time", "actual_mw"])
                .sort_values("start_time")
                .drop_duplicates(subset=["start_time"], keep="last")
                .reset_index(drop=True)
            )
            if "settlementDate" not in act_df.columns:
                act_df["settlementDate"] = act_df["start_time"].dt.strftime("%Y-%m-%d")
            if "settlementPeriod" not in act_df.columns:
                act_df["settlementPeriod"] = (
                    act_df["start_time"].dt.hour * 2
                    + (act_df["start_time"].dt.minute // 30)
                    + 1
                )
        self.actuals_df = act_df

        # Process Forecasts (WINDFOR)
        self.forecasts_raw_count = len(raw_forecasts)
        fc_df = pd.DataFrame(raw_forecasts)
        if not fc_df.empty:
            fc_df["start_time"] = pd.to_datetime(fc_df["startTime"], utc=True)
            fc_df["publish_time"] = pd.to_datetime(fc_df["publishTime"], utc=True)
            fc_df["forecast_mw"] = pd.to_numeric(fc_df["generation"], errors="coerce")
            fc_df = fc_df.dropna(subset=["start_time", "publish_time", "forecast_mw"])

            # Compute forecast horizon in hours: (startTime - publishTime)
            fc_df["horizon_hours"] = (
                fc_df["start_time"] - fc_df["publish_time"]
            ).dt.total_seconds() / 3600.0

            # CRITICAL DATA HYGIENE:
            # Remove negative-horizon backcast rows (where publishTime > startTime)
            # and restrict to valid short/medium-term horizons [0h, 72h]
            valid_mask = (fc_df["horizon_hours"] >= 0.0) & (
                fc_df["horizon_hours"] <= 72.0
            )
            self.backcast_rows_filtered = int((~valid_mask).sum())
            fc_df = (
                fc_df[valid_mask]
                .sort_values(["start_time", "publish_time"])
                .drop_duplicates(subset=["start_time", "publish_time"], keep="last")
                .reset_index(drop=True)
            )

        self.forecasts_df = fc_df


data_store = ElexonDataStore()
# GridPulse UK — Day-Ahead Wind Forecast & Thermal Procurement Workbench

**Live Deployed Application:** [https://YOUR-VERCEL-URL.vercel.app](https://YOUR-VERCEL-URL.vercel.app)

---

## 1. Executive Summary & Domain Problem Formulation

UK electricity utilities procuring power in the **Day-Ahead Wholesale Market** (EPEX SPOT / N2EX) must commit to non-renewable (thermal/gas) generation volumes on **Decision Day D-1** for all 48 half-hourly settlement periods of **Delivery Day D**.

Because wind power has near-zero marginal cost but high weather-driven volatility, traders face asymmetric operational risks:
- **Over-forecasting wind:** Actual generation falls short of forecast, exposing the utility to physical power deficits and punitive UK Balancing Mechanism cash-out prices.
- **Under-forecasting wind:** The utility over-procures thermal generation, locking in unnecessary fuel costs.

**GridPulse UK** solves both requirements for January 2026 Day-Ahead decisions using Elexon BMRS (`FUELHH` and `WINDFOR`) streams:
1. **Zero-Leakage Day-Ahead Procurement Desk (D-1):** Reconstructs the exact forecast state available at market gate closure (`09:20`, `09:50`, `15:30`, `18:00 UTC`), overlays empirical **P10–P90 uncertainty bands**, and calculates **Safe Wind MW** and **Recommended Thermal Procurement (MW / MWh)**.
2. **Quantitative Forecast Accuracy Lab:** Evaluates error degradation across lookahead horizons (`0h` to `48h`), directional bias, **P90/P95 over-forecast shortfall haircuts**, and a **2D Diurnal Hour-of-Day x Horizon Error Heatmap**.

---

## 2. Key Domain Edge Cases Discovered & Solved

1. **Eliminating Lookahead Leakage from Negative-Horizon Backcasts (`4,321` rows filtered):**
   - Inspection of the raw Elexon `/datasets/WINDFOR/stream` payload revealed that **20.5% (`4,321` of `21,024` records)** carry a `publishTime` later than `startTime` (negative forecast horizon). Our ingestion pipeline enforces strict causality: `publishTime <= cutoff <= startTime` and `0 <= horizon <= 72h`.
2. **January 2026 Decision Window Boundaries:**
   - A Day-Ahead purchase decision made on **January 31, 2026** governs delivery on **February 1, 2026**, while a decision made on **January 1, 2026** relies on forecasts published on **December 30–31, 2025**. Our data store ingests `2025-12-29` through `2026-02-02` (`1,632` half-hourly settlement periods with zero gaps).
3. **Temporal Resolution Alignment (`FUELHH` 30-min vs. `WINDFOR` 60-min):**
   - Supports both **60-minute Exact Inner-Join** (for pure statistical evaluation) and **30-minute Linear Interpolation per Forecast Run** (for 48-Settlement-Period trading desk dispatch).

---

## 3. Repository Directory & File Structure

- `api/index.py` — Serverless ASGI bridge for unified Vercel deployment
- `backend/app/main.py` — FastAPI application, CORS, lifespan & REST endpoints
- `backend/app/schemas.py` — Strict Pydantic v2 request/response contracts
- `backend/app/data_store.py` — Async Elexon BMRS client, sanitization & disk cache
- `backend/app/analytics.py` — Vectorized pandas/numpy Day-Ahead & Error Quantile engine
- `backend/data_cache/` — Pre-warmed Elexon JSON files for <150ms instant boot
- `backend/tests/test_analytics.py` — Unit & edge-case tests (leakage, backcasts, Jan 31 boundary)
- `backend/Dockerfile` & `backend/requirements.txt` — Production Python 3.12 container & pinned dependencies
- `frontend/src/App.tsx` — High-density Trading Desk & Accuracy Lab workbench
- `frontend/src/api.ts` & `frontend/src/types.ts` — Typed REST client & TypeScript domain interfaces
- `frontend/Dockerfile` & `frontend/nginx.conf` — Multi-stage Node 20 -> Nginx Alpine container
- `.github/workflows/ci.yml` — Automated GitHub Actions CI (Pytest + TypeScript build)
- `docker-compose.yml` — Single-command multi-container orchestration
- `vercel.json` — Unified cloud deployment routing configuration

---

## 4. How to Start the Application

### Option A: Using Docker Compose (Recommended)
    docker compose up --build

- **Frontend Workbench:** http://localhost:5173
- **Backend FastAPI Docs:** http://localhost:8000/docs
- **Backend Health Telemetry:** http://localhost:8000/api/v1/health

### Option B: Local Development (Python + Node.js)
1. **Start Backend (Port 8000):**
    cd backend
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    PYTHONPATH=. python -m pytest -v
    python -m uvicorn app.main:app --reload --port 8000

2. **Start Frontend (Port 5173):**
    cd frontend
    npm install
    npm run dev


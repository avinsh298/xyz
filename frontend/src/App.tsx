import React, { useEffect, useState, useMemo } from 'react';
import {
  Wind,
  Flame,
  ShieldAlert,
  Activity,
  Clock,
  BarChart3,
  Download,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Info,
  TrendingUp,
  Layers,
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import {
  fetchHealth,
  fetchDayAheadSchedule,
  fetchAccuracyAnalytics,
} from './api';
import {
  HealthResponse,
  DayAheadResponse,
  AccuracyAnalyticsResponse,
} from './types';

const JAN_DECISION_DATES = Array.from({ length: 31 }, (_, i) => {
  const day = String(i + 1).padStart(2, '0');
  return `2026-01-${day}`;
});

const GATE_CLOSURE_PRESETS = [
  { label: '09:20 UTC (EPEX Day-Ahead 60m Auction)', value: '09:20' },
  { label: '09:50 UTC (N2EX UK Day-Ahead Auction)', value: '09:50' },
  { label: '15:30 UTC (EPEX Half-Hourly GB Auction)', value: '15:30' },
  { label: '18:00 UTC (Evening Desk Final Review)', value: '18:00' },
];

const HORIZON_BUCKET_LABELS = [
  '0-6h (Intraday)',
  '6-12h (Near Day-Ahead)',
  '12-18h (Day-Ahead Morning)',
  '18-24h (Day-Ahead Afternoon)',
  '24-36h (Day-Ahead Evening/Next)',
  '36-48h (2-Day Ahead)',
];

function formatNumber(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return val.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatShortTime(iso: string): string {
  return iso.slice(11, 16);
}

function formatDateShort(iso: string): string {
  return iso.slice(5, 16).replace('T', ' ');
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'desk' | 'accuracy'>('desk');
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Tab 1: Day-Ahead Procurement Desk Controls
  const [decisionDate, setDecisionDate] = useState<string>('2026-01-15');
  const [cutoffTime, setCutoffTime] = useState<string>('09:20');
  const [resolution, setResolution] = useState<'30min' | '60min'>('30min');
  const [confidenceLevel, setConfidenceLevel] = useState<'p50' | 'p90' | 'p95'>('p90');
  const [baseDemandMw, setBaseDemandMw] = useState<number>(32000);
  const [deskData, setDeskData] = useState<DayAheadResponse | null>(null);
  const [deskLoading, setDeskLoading] = useState<boolean>(false);

  // Tab 2: Quantitative Forecast Accuracy Controls
  const [startDate, setStartDate] = useState<string>('2026-01-01');
  const [endDate, setEndDate] = useState<string>('2026-01-31');
  const [targetHorizon, setTargetHorizon] = useState<number>(24);
  const [accResolution, setAccResolution] = useState<'30min' | '60min'>('60min');
  const [heatmapMode, setHeatmapMode] = useState<'mae' | 'bias'>('mae');
  const [accData, setAccData] = useState<AccuracyAnalyticsResponse | null>(null);
  const [accLoading, setAccLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err) => setErrorMsg(err.message));
  }, []);

  useEffect(() => {
    setDeskLoading(true);
    fetchDayAheadSchedule({
      decision_date: decisionDate,
      cutoff_time_utc: cutoffTime,
      resolution,
      confidence_level: confidenceLevel,
      base_demand_mw: baseDemandMw,
    })
      .then((res) => {
        setDeskData(res);
        setErrorMsg(null);
      })
      .catch((err) => setErrorMsg(err.message))
      .finally(() => setDeskLoading(false));
  }, [decisionDate, cutoffTime, resolution, confidenceLevel, baseDemandMw]);

  useEffect(() => {
    setAccLoading(true);
    fetchAccuracyAnalytics({
      start_date: startDate,
      end_date: endDate,
      target_horizon_hours: targetHorizon,
      resolution: accResolution,
    })
      .then((res) => {
        setAccData(res);
        setErrorMsg(null);
      })
      .catch((err) => setErrorMsg(err.message))
      .finally(() => setAccLoading(false));
  }, [startDate, endDate, targetHorizon, accResolution]);

  // Transform Desk Timeseries for Recharts Fan Chart
  const chartTimeseries = useMemo(() => {
    if (!deskData) return [];
    return deskData.timeseries.map((pt) => {
      const p10 = pt.p10_band_mw ?? 0;
      const p90 = pt.p90_band_mw ?? 0;
      return {
        ...pt,
        timeLabel: `SP${String(pt.settlement_period).padStart(2, '0')} (${formatShortTime(pt.start_time)})`,
        shortTime: formatShortTime(pt.start_time),
        bandRange: pt.p10_band_mw !== null && pt.p90_band_mw !== null ? [p10, p90] : null,
      };
    });
  }, [deskData]);

  // Export Desk Schedule to CSV
  const handleExportCsv = () => {
    if (!deskData) return;
    const headers = [
      'start_time_utc',
      'settlement_date',
      'settlement_period',
      'publish_time_utc',
      'horizon_hours',
      'forecast_wind_mw',
      'safe_wind_mw',
      'actual_wind_mw',
      'forecast_error_mw',
      'demand_mw',
      'naive_thermal_mw',
      'recommended_thermal_mw',
      'actual_thermal_needed_mw',
      'unhedged_shortfall_mw',
    ];
    const rows = deskData.timeseries.map((r) =>
      [
        r.start_time,
        r.settlement_date,
        r.settlement_period,
        r.publish_time ?? '',
        r.horizon_hours ?? '',
        r.forecast_mw ?? '',
        r.safe_wind_mw ?? '',
        r.actual_mw ?? '',
        r.error_mw ?? '',
        r.demand_mw,
        r.naive_thermal_mw ?? '',
        r.recommended_thermal_mw ?? '',
        r.actual_thermal_needed_mw ?? '',
        r.unhedged_shortfall_mw ?? '',
      ].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `uk_dayahead_schedule_decision_${decisionDate}_cutoff_${cutoffTime.replace(':', '')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Lookup helper for 2D Heatmap
  const heatmapLookup = useMemo(() => {
    const map = new Map<string, { mae: number; bias: number; count: number }>();
    if (!accData) return map;
    for (const cell of accData.heatmap) {
      map.set(`${cell.hour_of_day}__${cell.horizon_bucket}`, {
        mae: cell.mae_mw,
        bias: cell.bias_mw,
        count: cell.sample_count,
      });
    }
    return map;
  }, [accData]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Institutional Navigation & Data Hygiene Telemetry Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Wind className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  GridPulse UK
                </h1>
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  Elexon BMRS Day-Ahead Desk
                </span>
              </div>
              <p className="text-xs text-slate-400">
                National Wind Generation Forecast Intelligence & Risk-Adjusted Thermal Procurement (Jan 2026)
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-slate-950/90 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('desk')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'desk'
                  ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              1. Day-Ahead Procurement Desk (D-1)
            </button>
            <button
              onClick={() => setActiveTab('accuracy')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'accuracy'
                  ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              2. Quantitative Forecast Accuracy Lab
            </button>
          </div>

          {/* Live Data Hygiene Telemetry Pill */}
          {health && (
            <div className="hidden xl:flex items-center gap-4 text-xs font-mono bg-slate-950/80 px-3.5 py-1.5 rounded-lg border border-slate-800">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                BMRS Stream Ready
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">
                FUELHH: <strong className="text-white">{formatNumber(health.actuals_count)}</strong> SPs
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">
                WINDFOR: <strong className="text-white">{formatNumber(health.forecasts_valid_count)}</strong> valid
              </span>
              <span
                className="text-amber-300/90 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20"
                title="Elexon WINDFOR stream includes negative-horizon backcast rows published after delivery. Filtered to prevent lookahead leakage."
              >
                {formatNumber(health.backcast_rows_filtered)} backcasts filtered
              </span>
            </div>
          )}
        </div>
      </header>

      {errorMsg && (
        <div className="max-w-[1600px] mx-auto w-full px-6 mt-4">
          <div className="bg-rose-950/60 border border-rose-500/40 text-rose-200 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>API Connection Error: {errorMsg}</span>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1: DAY-AHEAD PROCUREMENT DESK                                   */}
      {/* =================================================================== */}
      {activeTab === 'desk' && (
        <main className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5 flex-1">
          {/* Control Strip: Day-Ahead Time Machine */}
          <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-400" />
                <h2 className="text-sm font-semibold text-white">
                  Day-Ahead Decision Simulator (Zero-Leakage &ldquo;As-Of&rdquo; Cutoff Engine)
                </h2>
                {deskData && (
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                    Decision on {deskData.summary.decision_date} @ {cutoffTime} UTC &rarr; Delivery on{' '}
                    {deskData.summary.delivery_date}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {deskLoading && (
                  <span className="text-xs text-cyan-400 font-mono animate-pulse">
                    Recomputing schedule...
                  </span>
                )}
                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition"
                >
                  <Download className="h-3.5 w-3.5 text-cyan-400" />
                  Export Desk CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* 1. Decision Date (D-1) */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Purchase Decision Date (D-1)
                </label>
                <select
                  value={decisionDate}
                  onChange={(e) => setDecisionDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                >
                  {JAN_DECISION_DATES.map((d) => (
                    <option key={d} value={d}>
                      {d} (Delivers {d === '2026-01-31' ? '2026-02-01' : `2026-01-${String(Number(d.slice(8)) + 1).padStart(2, '0')}`})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Gate Closure Cutoff */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Market Gate Closure Cutoff (UTC)
                </label>
                <select
                  value={cutoffTime}
                  onChange={(e) => setCutoffTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                >
                  {GATE_CLOSURE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Risk Confidence Level */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Wind Reliability Confidence Hedge
                </label>
                <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {(['p50', 'p90', 'p95'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setConfidenceLevel(lvl)}
                      className={`py-1 rounded text-xs font-mono uppercase transition ${
                        confidenceLevel === lvl
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {lvl === 'p50' ? 'P50 Base' : lvl === 'p90' ? 'P90 Safe' : 'P95 Max'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Grid Resolution */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Settlement Resolution
                </label>
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setResolution('30min')}
                    className={`py-1 rounded text-xs font-mono transition ${
                      resolution === '30min'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    30m (48 SPs)
                  </button>
                  <button
                    onClick={() => setResolution('60min')}
                    className={`py-1 rounded text-xs font-mono transition ${
                      resolution === '60min'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    60m (Native)
                  </button>
                </div>
              </div>

              {/* 5. Consumer Demand Baseline */}
              <div>
                <div className="flex justify-between text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  <span>Consumer Demand Portfolio</span>
                  <span className="font-mono text-cyan-400">{formatNumber(baseDemandMw)} MW</span>
                </div>
                <input
                  type="range"
                  min={18000}
                  max={45000}
                  step={500}
                  value={baseDemandMw}
                  onChange={(e) => setBaseDemandMw(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1.5"
                />
              </div>
            </div>
          </section>

          {/* Executive KPI Cards */}
          {deskData && (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Card 1: Wind Forecast vs Safe Wind */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Latest Forecasted Wind ({deskData.summary.delivery_date})</span>
                  <Wind className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {formatNumber(deskData.summary.forecast_wind_mwh)} <span className="text-sm font-normal text-slate-400">MWh</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Safe Wind ({confidenceLevel.toUpperCase()} Risk-Adjusted):
                  </span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {formatNumber(deskData.summary.safe_wind_mwh)} MWh
                  </span>
                </div>
              </div>

              {/* Card 2: Recommended Day-Ahead Thermal Procurement */}
              <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-4 relative overflow-hidden">
                <div className="flex items-center justify-between text-xs text-amber-300 mb-1">
                  <span className="font-semibold">Recommended Thermal Buy (D-1)</span>
                  <Flame className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-amber-400">
                  {formatNumber(deskData.summary.recommended_thermal_mwh)}{' '}
                  <span className="text-sm font-normal text-slate-400">MWh</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Naive Thermal ({formatNumber(deskData.summary.naive_thermal_mwh)} MWh) + Hedge:
                  </span>
                  <span className="font-mono font-semibold text-amber-300">
                    +{formatNumber(deskData.summary.risk_buffer_mwh)} MWh buffer
                  </span>
                </div>
              </div>

              {/* Card 3: Ex-Post Actual Outcome & Forecast Bias */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Realized Wind Outturn & Error</span>
                  <Activity className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {formatNumber(deskData.summary.actual_wind_mwh)}{' '}
                  <span className="text-sm font-normal text-slate-400">MWh</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Day MAE: <strong className="text-white font-mono">{formatNumber(deskData.summary.day_mae_mw)} MW</strong>
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      deskData.summary.day_bias_mw > 0 ? 'text-rose-400' : 'text-cyan-400'
                    }`}
                  >
                    Bias: {deskData.summary.day_bias_mw > 0 ? '+' : ''}
                    {formatNumber(deskData.summary.day_bias_mw)} MW
                  </span>
                </div>
              </div>

              {/* Card 4: Shortfall Protection Proof */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Grid Imbalance Shortfall Protection</span>
                  <ShieldAlert className="h-4 w-4 text-rose-400" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-white">
                    {deskData.summary.unhedged_shortfall_events} &rarr; {deskData.summary.hedged_shortfall_events}
                  </span>
                  <span className="text-xs text-emerald-400 font-medium">
                    shortfall slots after {confidenceLevel.toUpperCase()} hedge
                  </span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Peak Half-Hour Over-Forecast:</span>
                  <span className="font-mono font-semibold text-rose-400">
                    {formatNumber(deskData.summary.max_shortfall_mw)} MW
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Main Charts Row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* Chart 1: Wind Forecast vs Actuals + Empirical Uncertainty Fan */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    1. Wind Generation Forecast vs. Actuals &amp; Empirical P10–P90 Uncertainty Fan
                  </h3>
                  <p className="text-xs text-slate-400">
                    Forecasts published &le; {cutoffTime} UTC on {decisionDate}. Green dashed line shows Safe Wind ({confidenceLevel.toUpperCase()}) relied upon for thermal hedging.
                  </p>
                </div>
              </div>

              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartTimeseries} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="shortTime"
                      stroke="#64748b"
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      label={{
                        value: 'MW',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: '#64748b', fontSize: 11 },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090d16',
                        borderColor: '#334155',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(val: any, name: string) => {
                        if (Array.isArray(val)) {
                          return [`${formatNumber(val[0])} – ${formatNumber(val[1])} MW`, 'Empirical P10–P90 Band'];
                        }
                        return [`${formatNumber(Number(val))} MW`, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="bandRange"
                      name="Empirical P10–P90 Band"
                      fill="#06b6d4"
                      fillOpacity={0.14}
                      stroke="none"
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast_mw"
                      name="Latest Day-Ahead Forecast (MW)"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="safe_wind_mw"
                      name={`Safe Relied-Upon Wind (${confidenceLevel.toUpperCase()})`}
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual_mw"
                      name="Actual Realized Wind (FUELHH)"
                      stroke="#f8fafc"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Thermal Procurement Dispatch & Shortfall Exposure */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    2. Day-Ahead Thermal Procurement Schedule vs. Actual Thermal Requirement
                  </h3>
                  <p className="text-xs text-slate-400">
                    Quantifies required non-wind procurement (Demand minus Safe Wind) and highlights unhedged balancing shortfalls in crimson.
                  </p>
                </div>
              </div>

              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartTimeseries} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="shortTime"
                      stroke="#64748b"
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090d16',
                        borderColor: '#334155',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(val: any, name: string) => [`${formatNumber(Number(val))} MW`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="demand_mw"
                      name="Total Consumer Demand (MW)"
                      fill="#334155"
                      fillOpacity={0.25}
                      stroke="#64748b"
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="naive_thermal_mw"
                      name="Naive Thermal Buy (Demand - Raw Forecast)"
                      stroke="#94a3b8"
                      strokeWidth={1.75}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="recommended_thermal_mw"
                      name={`Recommended Thermal Buy (${confidenceLevel.toUpperCase()} Hedge)`}
                      stroke="#f59e0b"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual_thermal_needed_mw"
                      name="Actual Thermal Needed (Ex-Post)"
                      stroke="#ec4899"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Bar
                      dataKey="unhedged_shortfall_mw"
                      name="Unhedged Shortfall if Naive (MW)"
                      fill="#f43f5e"
                      radius={[2, 2, 0, 0]}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Settlement Period Schedule Table */}
          {deskData && (
            <section className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Settlement Period Procurement &amp; Error Audit Ledger ({deskData.summary.delivery_date})
                  </h3>
                  <p className="text-xs text-slate-400">
                    Showing all {deskData.timeseries.length} periods with forecast publication timestamp, lookahead horizon, revision delta, and thermal hedge recommendation.
                  </p>
                </div>
              </div>
              <div className="max-h-[340px] overflow-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px] sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3 border-b border-slate-800">SP / Time (UTC)</th>
                      <th className="py-2.5 px-3 border-b border-slate-800">Forecast Pub Time</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right">Horizon</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right">Forecast Wind</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right">Rev &Delta;</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right text-emerald-400">
                        Safe Wind ({confidenceLevel.toUpperCase()})
                      </th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right">Actual Wind</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right">Error (Fc - Act)</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right">Demand</th>
                      <th className="py-2.5 px-3 border-b border-slate-800 text-right text-amber-400">
                        Rec. Thermal Buy
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {deskData.timeseries.map((pt) => {
                      const isShortfall = (pt.error_mw ?? 0) > 0;
                      return (
                        <tr key={pt.start_time} className="hover:bg-slate-800/40 transition">
                          <td className="py-2 px-3 text-slate-200 font-medium">
                            SP{String(pt.settlement_period).padStart(2, '0')} &bull; {formatShortTime(pt.start_time)}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {pt.publish_time ? formatDateShort(pt.publish_time) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300">
                            {pt.horizon_hours !== null ? `${pt.horizon_hours.toFixed(1)}h` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-cyan-300 font-medium">
                            {formatNumber(pt.forecast_mw)} MW
                          </td>
                          <td
                            className={`py-2 px-3 text-right ${
                              (pt.revision_delta_mw ?? 0) > 0
                                ? 'text-emerald-400'
                                : (pt.revision_delta_mw ?? 0) < 0
                                ? 'text-amber-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {pt.revision_delta_mw !== null
                              ? `${pt.revision_delta_mw > 0 ? '+' : ''}${formatNumber(pt.revision_delta_mw)}`
                              : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-400 font-semibold">
                            {formatNumber(pt.safe_wind_mw)} MW
                          </td>
                          <td className="py-2 px-3 text-right text-white">
                            {formatNumber(pt.actual_mw)} MW
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-semibold ${
                              isShortfall ? 'text-rose-400' : 'text-cyan-400'
                            }`}
                          >
                            {pt.error_mw !== null
                              ? `${pt.error_mw > 0 ? '+' : ''}${formatNumber(pt.error_mw)} MW`
                              : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300">
                            {formatNumber(pt.demand_mw)} MW
                          </td>
                          <td className="py-2 px-3 text-right text-amber-300 font-bold bg-amber-500/5">
                            {formatNumber(pt.recommended_thermal_mw)} MW
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      )}

      {/* =================================================================== */}
      {/* TAB 2: QUANTITATIVE FORECAST ACCURACY LAB                           */}
      {/* =================================================================== */}
      {activeTab === 'accuracy' && (
        <main className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5 flex-1">
          {/* Accuracy Filter Bar */}
          <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-400" />
                <h2 className="text-sm font-semibold text-white">
                  Quantitative Error Distribution &amp; Horizon Degradation Lab (January 2026)
                </h2>
              </div>
              {accLoading && (
                <span className="text-xs text-cyan-400 font-mono animate-pulse">
                  Computing statistical distributions...
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Evaluation Window Start
                </label>
                <select
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                >
                  {JAN_DECISION_DATES.slice(0, 25).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Evaluation Window End
                </label>
                <select
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                >
                  {JAN_DECISION_DATES.slice(5).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  <option value="2026-02-01">2026-02-01 (Includes Jan 31 D-1 Delivery)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  <span>Target Lookahead Horizon</span>
                  <span className="font-mono text-cyan-400">{targetHorizon} Hours Ahead</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={48}
                  step={2}
                  value={targetHorizon}
                  onChange={(e) => setTargetHorizon(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1.5"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Alignment Methodology
                </label>
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setAccResolution('60min')}
                    className={`py-1 rounded text-xs font-mono transition ${
                      accResolution === '60min'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    60m Exact Join
                  </button>
                  <button
                    onClick={() => setAccResolution('30min')}
                    className={`py-1 rounded text-xs font-mono transition ${
                      accResolution === '30min'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    30m Interpolated
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Quantitative KPI Cards */}
          {accData && (
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">
                  Mean Absolute Error ({targetHorizon}h Horizon)
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {formatNumber(accData.global_mae_mw)} <span className="text-sm font-normal text-slate-400">MW</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-xs text-slate-400 flex justify-between">
                  <span>Normalized MAE:</span>
                  <span className="font-mono text-cyan-300">{accData.normalized_mae_pct}% of peak</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">
                  Root Mean Squared Error (RMSE)
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {formatNumber(accData.global_rmse_mw)} <span className="text-sm font-normal text-slate-400">MW</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-xs text-slate-400 flex justify-between">
                  <span>Mean Abs % Error (MAPE):</span>
                  <span className="font-mono text-slate-200">{accData.global_mape_pct}%</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">
                  Directional Forecast Bias (Fc &minus; Act)
                </div>
                <div
                  className={`text-2xl font-bold font-mono ${
                    accData.mean_bias_mw > 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {accData.mean_bias_mw > 0 ? '+' : ''}
                  {formatNumber(accData.mean_bias_mw)} <span className="text-sm font-normal text-slate-400">MW</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-xs text-slate-400 flex justify-between">
                  <span>Over-Forecast Frequency:</span>
                  <span className="font-mono text-rose-300">{accData.overforecast_rate_pct}% of slots</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-4">
                <div className="text-xs text-amber-300 font-medium mb-1">
                  P90 Over-Forecast Shortfall Haircut
                </div>
                <div className="text-2xl font-bold font-mono text-amber-400">
                  +{formatNumber(accData.p90_overforecast_mw)}{' '}
                  <span className="text-sm font-normal text-slate-400">MW</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-xs text-slate-400 flex justify-between">
                  <span>P95 Extreme Haircut:</span>
                  <span className="font-mono text-rose-400">+{formatNumber(accData.p95_overforecast_mw)} MW</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">
                  Evaluated Forecast-Actual Pairs
                </div>
                <div className="text-2xl font-bold font-mono text-cyan-400">
                  {formatNumber(accData.total_evaluated_points)}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-xs text-slate-400 flex justify-between">
                  <span>Resolution Mode:</span>
                  <span className="font-mono text-slate-200">{accData.resolution}</span>
                </div>
              </div>
            </section>
          )}

          {/* Row 1: Horizon Error Degradation Curve + Error Distribution Histogram */}
          {accData && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* Horizon Degradation Chart */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-1">
                  1. Forecast Error Degradation Across Lookahead Horizons (0h &rarr; 48h)
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  Compares Mean Absolute Error (MAE), RMSE, and the 90th Percentile Over-Forecast Shortfall Risk across UK trading horizons.
                </p>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={accData.horizon_metrics} margin={{ top: 10, right: 15, left: 0, bottom: 15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="horizon_bucket"
                        stroke="#64748b"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                      />
                      <YAxis
                        stroke="#64748b"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        label={{
                          value: 'Error (MW)',
                          angle: -90,
                          position: 'insideLeft',
                          style: { fill: '#64748b', fontSize: 11 },
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#090d16',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(val: any, name: string) => [`${formatNumber(Number(val), 1)} MW`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="mae_mw" name="MAE (MW)" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="rmse_mw" name="RMSE (MW)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Line
                        type="monotone"
                        dataKey="p90_error_mw"
                        name="P90 Over-Forecast Risk (MW)"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Error Distribution Histogram */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-1">
                  2. Empirical Forecast Error Distribution (Error = Forecast &minus; Actual MW)
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  Right-tail bars (Error &gt; 0, crimson) represent wind over-prediction where the utility faces physical power deficits.
                </p>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={accData.error_histogram} margin={{ top: 10, right: 15, left: 0, bottom: 15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="bin_center"
                        stroke="#64748b"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
                      />
                      <YAxis
                        stroke="#64748b"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#090d16',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(val: any, name: string) => [`${val}%`, name]}
                        labelFormatter={(lbl) => `Error Bin Center: ${lbl} MW`}
                      />
                      <ReferenceLine x={0} stroke="#f8fafc" strokeDasharray="3 3" />
                      <Bar dataKey="frequency_pct" name="Share of Settlement Periods (%)">
                        {accData.error_histogram.map((entry, idx) => (
                          <Cell
                            key={`cell-${idx}`}
                            fill={entry.bin_center > 0 ? '#f43f5e' : '#06b6d4'}
                            fillOpacity={0.85}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Row 2: Custom 2D Hour-of-Day x Horizon Heatmap */}
          {accData && (
            <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    3. Diurnal Hour-of-Day &times; Lookahead Horizon Error Matrix (2D Heatmap)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Pinpoints specific delivery hours (e.g., 16:00–20:00 evening peak ramp) where wind forecast errors spike across horizons.
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setHeatmapMode('mae')}
                    className={`px-3 py-1 rounded text-xs font-mono transition ${
                      heatmapMode === 'mae'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    MAE Magnitude (MW)
                  </button>
                  <button
                    onClick={() => setHeatmapMode('bias')}
                    className={`px-3 py-1 rounded text-xs font-mono transition ${
                      heatmapMode === 'bias'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Directional Bias (Fc - Act)
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px] font-mono">
                  <thead>
                    <tr>
                      <th className="p-2 text-left text-slate-400 border-b border-slate-800 min-w-[190px]">
                        Horizon Bucket \ Hour (UTC)
                      </th>
                      {Array.from({ length: 24 }, (_, h) => (
                        <th
                          key={h}
                          className="p-1.5 text-center text-slate-400 border-b border-slate-800"
                        >
                          {String(h).padStart(2, '0')}h
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HORIZON_BUCKET_LABELS.map((bucket) => (
                      <tr key={bucket} className="border-b border-slate-800/50">
                        <td className="p-2 font-medium text-slate-300 whitespace-nowrap">
                          {bucket}
                        </td>
                        {Array.from({ length: 24 }, (_, h) => {
                          const cell = heatmapLookup.get(`${h}__${bucket}`);
                          if (!cell) {
                            return (
                              <td key={h} className="p-1 text-center text-slate-600">
                                —
                              </td>
                            );
                          }
                          const val = heatmapMode === 'mae' ? cell.mae : cell.bias;
                          let bg = 'rgba(15, 23, 42, 0.8)';
                          if (heatmapMode === 'mae') {
                            const intensity = Math.min(1, Math.max(0.12, val / 2400));
                            bg = `rgba(245, 158, 11, ${intensity.toFixed(2)})`;
                          } else {
                            const intensity = Math.min(1, Math.max(0.15, Math.abs(val) / 1800));
                            bg =
                              val >= 0
                                ? `rgba(244, 63, 94, ${intensity.toFixed(2)})`
                                : `rgba(6, 182, 212, ${intensity.toFixed(2)})`;
                          }
                          return (
                            <td
                              key={h}
                              style={{ backgroundColor: bg }}
                              className="p-1.5 text-center text-white border border-slate-900/60"
                              title={`${bucket} @ ${String(h).padStart(2, '0')}:00 UTC | MAE: ${cell.mae} MW | Bias: ${cell.bias} MW (n=${cell.count})`}
                            >
                              {Math.round(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Row 3: Continuous Full-Month Horizon Time-Series + Quantitative Bucket Table */}
          {accData && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              {/* Full-Month Horizon Backtest Chart */}
              <div className="xl:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-1">
                  4. Continuous January 2026 Forecast vs. Actuals Backtest ({targetHorizon}h Lookahead Horizon)
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  Evaluates national wind generation trajectories across the entire month of January 2026 at the selected {targetHorizon}-hour decision horizon.
                </p>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={accData.horizon_timeseries} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="start_time"
                        stroke="#64748b"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v) => v.slice(5, 10)}
                        minTickGap={35}
                      />
                      <YAxis
                        stroke="#64748b"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#090d16',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(val: any, name: string) => [`${formatNumber(Number(val))} MW`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Line
                        type="monotone"
                        dataKey="actual_mw"
                        name="Actual Wind (FUELHH)"
                        stroke="#f8fafc"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="forecast_mw"
                        name={`${targetHorizon}h Ahead Forecast (WINDFOR)`}
                        stroke="#38bdf8"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="error_mw"
                        name="Forecast Error (Fc - Act MW)"
                        fill="#f43f5e"
                        fillOpacity={0.25}
                        stroke="#f43f5e"
                        strokeWidth={1}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Horizon Quantile Summary Table */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">
                    5. Horizon Quantile &amp; Risk Reserve Table
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Empirical error quantiles used by the Day-Ahead Desk to compute P90/P95 thermal reserve buffers.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                        <tr>
                          <th className="py-2 px-2 border-b border-slate-800">Horizon</th>
                          <th className="py-2 px-2 border-b border-slate-800 text-right">MAE</th>
                          <th className="py-2 px-2 border-b border-slate-800 text-right">RMSE</th>
                          <th className="py-2 px-2 border-b border-slate-800 text-right">Bias</th>
                          <th className="py-2 px-2 border-b border-slate-800 text-right text-amber-400">
                            P90 Risk
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {accData.horizon_metrics.map((m) => (
                          <tr key={m.horizon_bucket} className="hover:bg-slate-800/40">
                            <td className="py-2 px-2 text-slate-200 font-sans text-[11px]">
                              {m.horizon_bucket.split(' ')[0]}
                            </td>
                            <td className="py-2 px-2 text-right text-cyan-300">
                              {formatNumber(m.mae_mw)}
                            </td>
                            <td className="py-2 px-2 text-right text-slate-300">
                              {formatNumber(m.rmse_mw)}
                            </td>
                            <td
                              className={`py-2 px-2 text-right ${
                                m.bias_mw > 0 ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {m.bias_mw > 0 ? '+' : ''}
                              {formatNumber(m.bias_mw)}
                            </td>
                            <td className="py-2 px-2 text-right text-amber-400 font-semibold">
                              +{formatNumber(m.p90_error_mw)} MW
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-4 bg-slate-950/90 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 space-y-1">
                  <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                    <Info className="h-3.5 w-3.5" />
                    <span>Trader Decision Rule</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    When purchasing day-ahead power at a <strong>18–24h horizon</strong>, discounting raw wind forecasts by the <strong>P90 Over-Forecast Haircut</strong> protects the utility from 90% of historical wind shortfall events.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
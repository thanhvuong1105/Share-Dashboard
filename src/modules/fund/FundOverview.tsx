import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type FundOverviewMetrics = {
  totalEquity: number;
  balance: number;
  usedMargin: number;
  availableMargin: number;
  riskMode: string;
  openPositions: number;
  winrate: number; // 0–1
  maxDrawdown: number; // -0.2 = -20%
  totalPnl: number;
  profitFactor: number;
  unrealizedPnl: number;
  activeBots: number;
  highestWin: number;
  highestLoss: number;
  streakCurrentWr: number;
  streakBestWr: number;
  lowestWr: number; // 0–1
  currency?: string;
};

export type EquityPoint = {
  time: string;
  equity: number;
  balance: number;
  unrealizedPnl: number; // dùng field này để vẽ Total PnL theo ngày
};

type FundOverviewProps = {
  metrics: FundOverviewMetrics;
  equityHistory?: EquityPoint[];
};

const formatCurrency = (value: number, currency = "USDT") => {
  if (isNaN(value)) return "-";
  return (
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " " +
    currency
  );
};

const formatPercent = (value: number) => {
  if (isNaN(value)) return "-";
  return (value * 100).toFixed(2) + "%";
};

const FundOverview: React.FC<FundOverviewProps> = ({
  metrics,
  equityHistory = [],
}) => {
  const currency = metrics.currency ?? "USDT";

  return (
    <div className="flex flex-col gap-6">
      {/* ===== 8 CARD OVERVIEW ===== */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Equity */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Total Equity
          </div>
          <div className="mt-2 text-2xl font-semibold text-neutral-50">
            {formatCurrency(metrics.totalEquity, currency)}
          </div>
        </div>

        {/* Balance */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Balance
          </div>
          <div className="mt-2 text-2xl font-semibold text-neutral-50">
            {formatCurrency(metrics.balance, currency)}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Unrealized PnL:{" "}
            <span
              className={
                metrics.unrealizedPnl > 0
                  ? "text-emerald-400"
                  : metrics.unrealizedPnl < 0
                  ? "text-red-400"
                  : "text-neutral-200"
              }
            >
              {formatCurrency(metrics.unrealizedPnl, currency)}
            </span>
          </div>
        </div>

        {/* Open Positions */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Open Positions
          </div>
          <div className="mt-2 text-2xl font-semibold text-neutral-50">
            {metrics.openPositions}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Risk Mode:{" "}
            <span className="text-sky-400 font-medium">
              {metrics.riskMode}
            </span>
          </div>
        </div>

        {/* Active Bots */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Active Bots
          </div>
          <div className="mt-2 text-2xl font-semibold text-neutral-50">
            {metrics.activeBots}
          </div>
        </div>

        {/* Total PnL */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Total PnL
          </div>
          <div
            className={
              "mt-2 text-2xl font-semibold " +
              (metrics.totalPnl > 0
                ? "text-emerald-400"
                : metrics.totalPnl < 0
                ? "text-red-400"
                : "text-neutral-50")
            }
          >
            {formatCurrency(metrics.totalPnl, currency)}
          </div>
        </div>

        {/* Winrate */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Winrate
          </div>
          <div className="mt-2 text-2xl font-semibold text-emerald-400">
            {formatPercent(metrics.winrate)}
          </div>
        </div>

        {/* Max Drawdown */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Max Drawdown
          </div>
          <div className="mt-2 text-2xl font-semibold text-red-400">
            {formatPercent(metrics.maxDrawdown)}
          </div>
        </div>

        {/* Profit Factor */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">
            Profit Factor
          </div>
          <div className="mt-2 text-2xl font-semibold text-neutral-50">
            {metrics.profitFactor.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ===== CHART FUND OVERVIEW ===== */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-neutral-100">
            Fund Management Overview
          </div>
          <div className="text-xs text-neutral-500">
            Equity / Total PnL
          </div>
        </div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityHistory}>
              <defs>
                <linearGradient id="equity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="totalPnl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#171717" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: "#a3a3a3" }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#a3a3a3" }}
                width={72}
                tickFormatter={(v) =>
                  v.toLocaleString("en-US", { maximumFractionDigits: 0 })
                }
              />

              <Tooltip
                contentStyle={{
                  backgroundColor: "#0a0a0a",
                  border: "1px solid #262626",
                  borderRadius: "0.75rem",
                  fontSize: 12,
                  color: "#e5e5e5",
                }}
                labelStyle={{ color: "#e5e5e5" }}
                formatter={(value: any) =>
                  value.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }) + " " + currency
                }
              />

              <Legend
                wrapperStyle={{ fontSize: 12, color: "#d4d4d4" }}
                verticalAlign="top"
                height={24}
              />

              {/* Equity */}
              <Area
                type="monotone"
                dataKey="equity"
                name="Equity"
                stroke="#22c55e"
                fill="url(#equity)"
                strokeWidth={2}
              />

              {/* Total PnL – dùng field unrealizedPnl của EquityPoint để vẽ */}
              <Area
                type="monotone"
                dataKey="unrealizedPnl"
                name="Total PnL"
                stroke="#f97316"
                fill="url(#totalPnl)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default FundOverview;

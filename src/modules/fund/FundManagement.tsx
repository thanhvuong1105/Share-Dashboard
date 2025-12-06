// src/modules/fund/FundManagement.tsx
import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

import PnLHistory, { type RangePreset } from "./PnlHistory";
import {
  fundMetricsMock,
  fundEquityHistoryMock,
  type EquityHistoryPoint,
} from "./fundMockData";
import { type Bot } from "../bots/BotTable";
import { fetchPortfolioPnlHistory } from "../../okxClient";

// ===============================
// Types
// ===============================
export type BotAllocation = {
  botId: string;
  botName: string;
  symbol: string;
  side: string;
  usedMargin: number;
  pnl: number;
};

type LocalRangePreset = "7D" | "30D" | "90D" | "ALL";

type FundManagementProps = {
  fundMetrics?: {
    totalEquity?: number;
    balance?: number;
    realTimePnl?: number;
    openPositions?: number;
    activeBots?: number;
    totalPnl?: number;
    winrate?: number;
    maxDrawdown?: number;
    profitFactor?: number;
    usedMargin?: number;
    availableMargin?: number;
    riskMode?: string;
    currency?: string;
  };
  equityHistory?: EquityHistoryPoint[];
  pnlHistory?: any;
  bots?: Bot[];
};

// ===============================
// Formatters
// ===============================
const formatCurrency = (value: number | undefined, currency = "USDT") => {
  if (value === undefined || isNaN(value)) return "-";
  return (
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " " + currency
  );
};

const formatPercent = (value: number | undefined) => {
  if (value === undefined || isNaN(value)) return "-";
  return (value * 100).toFixed(2) + "%";
};

// Filter Equity theo Range
const filterByRange = <T,>(data: T[], range: LocalRangePreset): T[] => {
  if (range === "ALL") return data;
  const n = range === "7D" ? 7 : range === "30D" ? 30 : 90;
  if (data.length <= n) return data;
  return data.slice(data.length - n);
};

// ===============================
// MAIN COMPONENT
// ===============================
export const FundManagement: React.FC<FundManagementProps> = ({
  fundMetrics,
  equityHistory,
  bots = [],
}) => {
  const [activeTab, setActiveTab] =
    useState<"overview" | "pnl">("overview");

  // Local range (fund only)
  const [range, setRange] = useState<LocalRangePreset>("30D");
  const [portfolioPnlAllTime, setPortfolioPnlAllTime] = useState<number | null>(
    null
  );

  // lấy PnL history (all bots, range ALL) để cộng vào Balance
  useEffect(() => {
    let cancelled = false;

    const loadAllRangePnl = async () => {
      try {
        const trades = await fetchPortfolioPnlHistory({ range: "ALL" });
        if (cancelled) return;
        const last = trades[trades.length - 1];
        const cumulative = Number(
          last?.cumulative ??
            trades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
        );
        setPortfolioPnlAllTime(Number.isFinite(cumulative) ? cumulative : 0);
      } catch (err) {
        console.warn("⚠️ Failed to fetch ALL-range PnL history:", err);
        if (!cancelled) {
          setPortfolioPnlAllTime(0);
        }
      }
    };

    loadAllRangePnl();
    const id = setInterval(loadAllRangePnl, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // mock fallback
  const baseMetrics = fundMetrics ?? fundMetricsMock;
  const equityRaw: EquityHistoryPoint[] =
    equityHistory && equityHistory.length > 0
      ? equityHistory
      : fundEquityHistoryMock;

  // apply range filtering
  const equitySource = filterByRange(equityRaw, range).map((d, _, arr) => {
    // nếu totalPnl chưa có, tính chênh lệch so với điểm đầu trong phạm vi
    if (d.totalPnl === undefined && arr.length > 0) {
      const first = arr[0];
      return {
        ...d,
        totalPnl:
          d.totalEquity !== undefined && first.totalEquity !== undefined
            ? d.totalEquity - first.totalEquity
            : 0,
      };
    }
    return d;
  });

  // ===============================
  // Recalculate metrics by current range
  // ===============================
  const latestEquityPoint = equitySource[equitySource.length - 1];

  // Aggregate từ Bot List
  const aggregateFromBots = () => {
    if (!bots.length) return null;
    const getBotTrades = (bot: Bot) => {
      const total = Number(bot.totalTrades);
      if (Number.isFinite(total)) {
        return total;
      }
      const closed = Number(bot.totalTradesClosed ?? 0);
      const openFallback = bot.totalTradesOpen ?? (bot.hasOpenPosition ? 1 : 0);
      const open = Number(openFallback ?? 0);
      const fallback = closed + open;
      return fallback > 0 ? fallback : 0;
    };
    const runningBots = bots.filter(
      (b) =>
        typeof b.status === "string" &&
        b.status.toLowerCase().trim() === "running"
    );
    const activeBots = runningBots.length || bots.length;
    // Open positions: bot có hasOpenPosition = true, fallback bot đang chạy
    const botsWithOpen =
      bots.filter((b) => b.hasOpenPosition).length || runningBots.length;
    const openPositions = botsWithOpen;
    const totalPnlFromBots = bots.reduce(
      (s, b) => s + Number(b.totalPnl || 0),
      0
    );
    // Balance = tổng vốn đã deploy + PnL history (all bots, all time).
    const totalInvestedFromBots = bots.reduce((sum, bot) => {
      const invested = Number(bot.investedAmount ?? 0);
      return Number.isFinite(invested) ? sum + invested : sum;
    }, 0);
    const hasAllRangePnl =
      portfolioPnlAllTime !== null && Number.isFinite(portfolioPnlAllTime);
    const realizedPnlAllRange = hasAllRangePnl
      ? (portfolioPnlAllTime as number)
      : totalPnlFromBots;
    const balanceFromBots = totalInvestedFromBots + realizedPnlAllRange;
    const realTimePnlFromBots = bots.reduce(
      (sum, bot) => sum + Number(bot.closedPnlAllTime ?? 0),
      0
    );
    const totalEquityFromBots =
      totalInvestedFromBots + realTimePnlFromBots + totalPnlFromBots;
    const tradesSum = bots.reduce((s, b) => s + getBotTrades(b), 0);
    const winTrades = bots.reduce((s, b) => {
      const trades = getBotTrades(b);
      const wr = Number((b as any).avgWr || 0);
      return s + trades * wr;
    }, 0);
    const winrate =
      tradesSum > 0 ? Math.max(0, Math.min(1, winTrades / tradesSum)) : 0;

    return {
      activeBots,
      openPositions,
      totalPnlFromBots,
      totalEquityFromBots,
      balanceFromBots,
      realTimePnlFromBots,
      initialFromBots: totalInvestedFromBots,
      winrate,
    };
  };

  const botAgg = aggregateFromBots();

  const metricsRange = {
    ...baseMetrics,
    totalEquity:
      botAgg?.totalEquityFromBots ??
      latestEquityPoint?.totalEquity ??
      baseMetrics.totalEquity ??
      0,
    balance:
      botAgg?.balanceFromBots !== undefined
        ? botAgg.balanceFromBots
        : latestEquityPoint?.balance ?? baseMetrics.balance ?? 0,
    initial:
      botAgg?.initialFromBots !== undefined
        ? botAgg.initialFromBots
        : baseMetrics.balance ?? 0,
    totalPnl:
      botAgg?.totalPnlFromBots ??
      baseMetrics.totalPnl ??
      0,
    realTimePnl:
      botAgg?.realTimePnlFromBots ??
      baseMetrics.realTimePnl ??
      0,
    openPositions: botAgg?.openPositions ?? baseMetrics.openPositions ?? 0,
    activeBots: botAgg?.activeBots ?? baseMetrics.activeBots ?? 0,
    winrate: botAgg?.winrate ?? baseMetrics.winrate ?? 0,
  };

  const currency = baseMetrics.currency ?? "USDT";
  const totalPnlValue = metricsRange.totalPnl ?? 0;

  // ===============================
  // RENDER UI
  // ===============================
  return (
    <div className="flex flex-col gap-4">
      {/* Tabs + Range Selector */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              activeTab === "overview"
                ? "bg-neutral-800 border-neutral-600 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
            }`}
          >
            Overview
          </button>

          <button
            onClick={() => setActiveTab("pnl")}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              activeTab === "pnl"
                ? "bg-neutral-800 border-neutral-600 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
            }`}
          >
            PnL History
          </button>
        </div>

        {/* RANGE chỉ hiển thị ở tab Overview */}
        {activeTab === "overview" && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">Range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as LocalRangePreset)}
              className="bg-neutral-900 border border-neutral-700 text-xs rounded-full px-3 py-1.5 text-neutral-200 outline-none"
            >
              <option value="7D">7D</option>
              <option value="30D">30D</option>
              <option value="90D">90D</option>
              <option value="ALL">All</option>
            </select>
          </div>
        )}
      </div>

      {/* ==========================
          TAB: OVERVIEW
      ========================== */}
      {activeTab === "overview" ? (
        <>
          {/* OVERVIEW CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Total Equity */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Total Equity</div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {formatCurrency(metricsRange.totalEquity, currency)}
              </div>
            </div>

            {/* Initial Investment */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">
                Initial Investment
              </div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {formatCurrency(metricsRange.initial, currency)}
              </div>
            </div>

            {/* Open Positions */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Open Positions</div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {baseMetrics.openPositions}
              </div>
            </div>

            {/* Active Bots */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Active Bots</div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {baseMetrics.activeBots}
              </div>
            </div>

            {/* Total PnL Unrealline */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">
                Total PnL Unrealline
              </div>
              <div
                className={
                  "mt-1 text-base font-semibold " +
                  (totalPnlValue > 0
                    ? "text-emerald-400"
                    : totalPnlValue < 0
                    ? "text-red-400"
                    : "text-neutral-50")
                }
              >
                {formatCurrency(metricsRange.totalPnl, currency)}
              </div>
            </div>

            {/* Total Profit */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Total Profit</div>
              <div
                className={
                  "mt-1 text-base font-semibold " +
                  (metricsRange.realTimePnl > 0
                    ? "text-emerald-400"
                    : metricsRange.realTimePnl < 0
                    ? "text-red-400"
                    : "text-neutral-50")
                }
              >
                {formatCurrency(metricsRange.realTimePnl, currency)}
              </div>
            </div>

            {/* Winrate */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Winrate</div>
              <div className="mt-1 text-base font-semibold text-emerald-400">
                {formatPercent(baseMetrics.winrate)}
              </div>
            </div>

            {/* Max DD */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Max Drawdown</div>
              <div className="mt-1 text-base font-semibold text-red-400">
                {formatPercent(baseMetrics.maxDrawdown)}
              </div>
            </div>

            {/* Profit Factor */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Profit Factor</div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {baseMetrics.profitFactor?.toFixed(2) ?? "-"}
              </div>
            </div>
          </div>

          {/* ==========================
              FUND OVERVIEW CHART
          ========================== */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-neutral-100">
                Fund Overview
              </div>
              <div className="text-xs text-neutral-500">
                Total Equity / Total PnL Unrealline
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equitySource}>
                  <defs>
                    <linearGradient id="equity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>

                    <linearGradient id="totalpnl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.6} />
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
                    tickFormatter={(v) =>
                      v.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })
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
                      formatCurrency(value as number, currency)
                    }
                  />

                  <Legend
                    wrapperStyle={{ fontSize: 12, color: "#d4d4d4" }}
                    verticalAlign="top"
                    height={24}
                  />

                  <Area
                    type="monotone"
                    dataKey="totalEquity"
                    name="Total Equity"
                    stroke="#22c55e"
                    fill="url(#equity)"
                    strokeWidth={2}
                  />

                  <Area
                    type="monotone"
                    dataKey="totalPnl"
                    name="Total PnL Unrealline"
                    stroke="#f97316"
                    fill="url(#totalpnl)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        // ==========================
        // TAB: PORTFOLIO PnL HISTORY
        // ==========================
        <PnLHistory
          mode="portfolio"
          defaultRange={range as RangePreset}
        />
      )}
    </div>
  );
};

export default FundManagement;

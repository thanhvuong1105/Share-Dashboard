// src/modules/fund/FundManagement.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
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
import { type Bot, type BotPositionHistoryEntry } from "../bots/BotTable";
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
  botHistories?: Record<string, number[]>;
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

const collectPositionHistory = (bots: Bot[]): BotPositionHistoryEntry[] =>
  bots
    .flatMap((bot) =>
      (bot.positionHistory ?? []).map((entry) => ({
        pnl: Number(entry.pnl || 0),
        closeTs: Number(entry.closeTs || 0),
      }))
    )
    .filter(
      (entry) =>
        Number.isFinite(entry.pnl) &&
        Number.isFinite(entry.closeTs) &&
        entry.closeTs > 0
    );

const calcMaxDrawdownFromHistory = (
  history: BotPositionHistoryEntry[],
  initialEquity: number
): number | undefined => {
  if (!history.length) return undefined;
  const sorted = [...history].sort((a, b) => a.closeTs - b.closeTs);
  const startingEquity =
    Number.isFinite(initialEquity) && initialEquity > 0
      ? initialEquity
      : 1;
  let equity = startingEquity;
  let peak = startingEquity;
  let maxDrawdown = 0;

  for (const entry of sorted) {
    const pnl = Number(entry.pnl);
    if (!Number.isFinite(pnl)) continue;
    equity += pnl;
    if (equity > peak) {
      peak = equity;
    }
    if (peak > 0) {
      const dd = (equity - peak) / peak;
      if (dd < maxDrawdown) {
        maxDrawdown = dd;
      }
    }
  }

  return maxDrawdown;
};

// ===============================
// MAIN COMPONENT
// ===============================
export const FundManagement: React.FC<FundManagementProps> = ({
  fundMetrics,
  equityHistory,
  bots = [],
  botHistories,
}) => {
  const [activeTab, setActiveTab] =
    useState<"overview" | "pnl">("overview");

  const [portfolioPnlAllTime, setPortfolioPnlAllTime] = useState<number | null>(
    null
  );
  const [externalBots, setExternalBots] = useState<Bot[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<Bot[]>;
      if (Array.isArray(custom.detail)) {
        setExternalBots(custom.detail);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("bots-updated", handler as EventListener);
      return () => {
        window.removeEventListener("bots-updated", handler as EventListener);
      };
    }
  }, []);

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

  // apply baseline calculations (no range filtering)
  const equitySource = equityRaw.map((d, _, arr) => {
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
  const equityChartData = useMemo(
    () =>
      equitySource.map((point) => ({
        time: point.time,
        equityValue: Number(point.totalEquity ?? 0),
      })),
    [equitySource]
  );

  // ===============================
  // Recalculate metrics (no range slicing)
  // ===============================
  const latestEquityPoint = equitySource[equitySource.length - 1];

  // Aggregate từ Bot List
  const mergedBots = bots.length ? bots : externalBots;

  const aggregateFromBots = () => {
    if (!mergedBots.length) return null;
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
    const runningBots = mergedBots.filter(
      (b) =>
        typeof b.status === "string" &&
        b.status.toLowerCase().trim() === "running"
    );
    const activeBots = runningBots.length || mergedBots.length;

    const openPositions = mergedBots.reduce((count, bot) => {
      const entry = Number(bot.entryPrice);
      return Number.isFinite(entry) && entry > 0 ? count + 1 : count;
    }, 0);
    const totalPnlFromBots = mergedBots.reduce(
      (s, b) => s + Number(b.totalPnl || 0),
      0
    );
    const positionPnlFromBots = mergedBots.reduce(
      (s, b) => s + Number(b.positionPnl || 0),
      0
    );
    // Balance = tổng vốn đã deploy + PnL history (all bots, all time).
    const totalInvestedFromBots = mergedBots.reduce((sum, bot) => {
      const invested = Number(bot.investedAmount ?? 0);
      return Number.isFinite(invested) ? sum + invested : sum;
    }, 0);
    const hasAllRangePnl =
      portfolioPnlAllTime !== null && Number.isFinite(portfolioPnlAllTime);
    const realizedPnlAllRange = hasAllRangePnl
      ? (portfolioPnlAllTime as number)
      : totalPnlFromBots;
    const balanceFromBots = totalInvestedFromBots + realizedPnlAllRange;
    const realTimePnlFromBots = mergedBots.reduce(
      (sum, bot) => sum + Number(bot.closedPnlAllTime ?? 0),
      0
    );
    const totalEquityFromBots =
      totalInvestedFromBots + realTimePnlFromBots + totalPnlFromBots;
    // Aggregate winrate dựa trên position history (PnL > 0)
    const portfolioHistory = collectPositionHistory(mergedBots);
    let totalClosedTrades = 0;
    let totalWins = 0;

    if (portfolioHistory.length) {
      for (const entry of portfolioHistory) {
        totalClosedTrades += 1;
        if (entry.pnl > 0) totalWins += 1;
      }
    }

    // Fallback khi không có history: ước tính theo avgWr * totalTrades
    if (totalClosedTrades === 0) {
      const tradesSum = mergedBots.reduce((s, b) => s + getBotTrades(b), 0);
      const winTrades = mergedBots.reduce((s, b) => {
        const trades = getBotTrades(b);
        const wr = Number((b as any).avgWr || 0);
        return s + trades * wr;
      }, 0);
      totalClosedTrades = tradesSum;
      totalWins = winTrades;
    }
    const profitFactors = mergedBots
      .map((bot) => Number(bot.profitFactor))
      .filter((val) => Number.isFinite(val) && val > 0);
    const profitFactor =
      profitFactors.length > 0
        ? profitFactors.reduce((sum, val) => sum + val, 0) /
          profitFactors.length
        : undefined;

    if (botHistories && Object.keys(botHistories).length) {
      totalClosedTrades = 0;
      totalWins = 0;
      mergedBots.forEach((bot) => {
        const pnlList = bot.algoId ? botHistories[bot.algoId] : undefined;
        if (!pnlList || !Array.isArray(pnlList)) return;
        pnlList.forEach((pnl) => {
          const pnlValue = Number(pnl);
          if (!Number.isFinite(pnlValue)) return;
          if (pnlValue > 0) {
            totalWins += 1;
            totalClosedTrades += 1;
          } else if (pnlValue < 0) {
            totalClosedTrades += 1;
          }
        });
      });
    }

    const winrateNormalized =
      totalClosedTrades > 0
        ? Math.max(0, Math.min(1, totalWins / totalClosedTrades))
        : 0;

    // Drawdown dựa trên history
    const maxDrawdownFromBots = calcMaxDrawdownFromHistory(
      portfolioHistory,
      totalInvestedFromBots
    );

    return {
      activeBots,
      totalPnlFromBots,
      totalEquityFromBots,
      balanceFromBots,
      realTimePnlFromBots,
      initialFromBots: totalInvestedFromBots,
      positionPnlTotal: positionPnlFromBots,
      winrate: winrateNormalized,
      profitFactor,
      maxDrawdownFromBots,
      openPositions,
    };
  };

  const botAgg = aggregateFromBots();

  const initialValue = Number(
    botAgg?.initialFromBots ?? baseMetrics.balance ?? 0
  );
  const totalPnlValueFromBots = Number(
    botAgg?.positionPnlTotal ?? baseMetrics.totalPnl ?? 0
  );
  const realTimePnlValue = Number(
    botAgg?.realTimePnlFromBots ?? baseMetrics.realTimePnl ?? 0
  );

  const totalEquityComputed =
    (Number.isFinite(initialValue) ? initialValue : 0) +
    (Number.isFinite(realTimePnlValue) ? realTimePnlValue : 0) +
    (Number.isFinite(totalPnlValueFromBots) ? totalPnlValueFromBots : 0);

  const metricsRange = {
    ...baseMetrics,
    totalEquity: totalEquityComputed,
    balance:
      botAgg?.balanceFromBots !== undefined
        ? botAgg.balanceFromBots
        : latestEquityPoint?.balance ?? baseMetrics.balance ?? 0,
    initial: initialValue,
    totalPnl: totalPnlValueFromBots,
    realTimePnl: realTimePnlValue,
    openPositions:
      botAgg?.openPositions !== undefined
        ? botAgg.openPositions
        : baseMetrics.openPositions ?? 0,
    activeBots: botAgg?.activeBots ?? baseMetrics.activeBots ?? 0,
    winrate:
      botAgg?.winrate !== undefined
        ? botAgg.winrate
        : baseMetrics.winrate ?? 0,
    profitFactor:
      botAgg?.profitFactor ??
      baseMetrics.profitFactor ??
      undefined,
    maxDrawdown:
      botAgg?.maxDrawdownFromBots !== undefined
        ? botAgg.maxDrawdownFromBots
        : baseMetrics.maxDrawdown ?? 0,
  };

  const currency = baseMetrics.currency ?? "USDT";
  const totalPnlValue = metricsRange.totalPnl ?? 0;

  // ===============================
  // RENDER UI
  // ===============================
  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex items-center gap-2">
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
                {Number.isFinite(metricsRange.openPositions as number)
                  ? Number(metricsRange.openPositions).toLocaleString("en-US")
                  : "-"}
              </div>
            </div>

            {/* Active Bots */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Active Bots</div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {Number.isFinite(metricsRange.activeBots as number)
                  ? Number(metricsRange.activeBots).toLocaleString("en-US")
                  : "-"}
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
                {formatPercent(metricsRange.winrate)}
              </div>
            </div>

            {/* Max DD */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Max Drawdown</div>
              <div className="mt-1 text-base font-semibold text-red-400">
                {formatPercent(metricsRange.maxDrawdown)}
              </div>
            </div>

            {/* Profit Factor */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="text-xs text-neutral-500">Profit Factor</div>
              <div className="mt-1 text-base font-semibold text-neutral-50">
                {metricsRange.profitFactor !== undefined
                  ? metricsRange.profitFactor.toFixed(2)
                  : "-"}
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/70">
              <div className="text-sm font-semibold text-neutral-100">
                Fund Overview · Equity Chart
              </div>
              <div className="text-xs text-neutral-500">Total Equity</div>
            </div>

            <div className="h-64 px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityChartData}>
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
                  <Line
                    type="monotone"
                    dataKey="equityValue"
                    name="Total Equity"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ==========================
              FUND OVERVIEW CHART
          ========================== */}
        </>
      ) : (
        // ==========================
        // TAB: PORTFOLIO PnL HISTORY
        // ==========================
        <PnLHistory
          mode="portfolio"
          defaultRange={"30D" as RangePreset}
        />
      )}
    </div>
  );
};

export default FundManagement;

import React, { useEffect, useState } from "react";
import FundManagement from "./modules/fund/FundManagement";
import BotList from "./modules/bots/BotList";
import { type Bot } from "./modules/bots/BotTable";

import { type EquityHistoryPoint } from "./modules/fund/fundMockData";

import {
  fetchFundOverview,
  type FundOverviewApiPayload,
  fetchLatestTicker,
  fetchMarketTicker,
  type TickerInfo,
} from "./okxClient";
import { CoinLogo } from "./icons/CoinLogos";

type MainTab = "fund" | "bots";

type FundMetricsState = {
  totalEquity?: number;
  balance?: number;
  openPositions: number;
  activeBots: number;
  totalPnl?: number;
  winrate?: number;
  maxDrawdown?: number;
  profitFactor?: number;
  usedMargin?: number;
  availableMargin?: number;
  riskMode?: string;
  currency?: string;
};

const App: React.FC = () => {
  const [tab, setTab] = useState<MainTab>("fund");

  const [fundMetrics, setFundMetrics] = useState<
    FundMetricsState | undefined
  >(undefined);

  const [equityHistory, setEquityHistory] = useState<EquityHistoryPoint[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tickers, setTickers] = useState<Record<string, TickerInfo>>({});

  // Hydrate equity history từ localStorage để giữ data cũ trên chart
  useEffect(() => {
    const stored = localStorage.getItem("equityHistory");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setEquityHistory(parsed);
        }
      } catch {
        // ignore parse errors
      }
    }

  }, []);

  // Map OKX → FundManagement metrics
  const mapOkxToFundMetrics = (
    okx: FundOverviewApiPayload
  ): FundMetricsState => {
    return {
      totalEquity: okx.totalEquity,
      balance: okx.balance,
      totalPnl: okx.totalPnl,
      // mấy field dưới chưa có data thật -> mock tạm
      openPositions: 0,
      activeBots: 0,
      winrate: 0.7,
      maxDrawdown: -0.2,
      profitFactor: 1.8,
      riskMode: "Cross",
      currency: okx.currency || "USDT",
    };
  };

  const ACTIVE_POLL_MS = 5000;
  const IDLE_POLL_MS = 10000;
  const MAX_EQUITY_POINTS = 100; // tránh phình dữ liệu gây lag UI thêm

  // Gọi OKX định kỳ (linh hoạt 3s hoặc 5s)
  useEffect(() => {
    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fetching = false;

    const fetchAndUpdate = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const overview = await fetchFundOverview();
        if (!isMounted) return;

        setFundMetrics(mapOkxToFundMetrics(overview));

        const now = new Date();
        const nowLabel = now.toLocaleString("en-GB", {
          hour12: false,
        });
        setLastUpdated(nowLabel);
        setFetchError(null);

        setEquityHistory((prev) => {
          const next = [
            ...prev,
            {
              time: nowLabel,
              totalEquity: overview.totalEquity,
              balance: overview.balance,
              totalPnl: overview.totalPnl,
            },
          ];
          const trimmed =
            next.length > MAX_EQUITY_POINTS
              ? next.slice(next.length - MAX_EQUITY_POINTS)
              : next;
          try {
            localStorage.setItem("equityHistory", JSON.stringify(trimmed));
          } catch {
            // ignore storage errors
          }
          return trimmed;
        });
      } catch (err: any) {
        if (!isMounted) return;
        console.error("❌ Failed to fetch OKX:", err);
        setFetchError(err?.message || "Failed to refresh data");
      } finally {
        fetching = false;
      }
    };

    const scheduleNext = () => {
      if (timer) clearTimeout(timer);
      const interval = tab === "fund" ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      timer = setTimeout(async () => {
        await fetchAndUpdate();
        if (!isMounted) return;
        scheduleNext();
      }, interval);
    };

    fetchAndUpdate();
    scheduleNext();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    const symbols = ["BTCUSDT.P", "ETHUSDT.P"];

    const symbolToInstId = (sym: string) => {
      const base = sym.toUpperCase().replace(/\.P$/, "");
      return base.endsWith("USDT")
        ? `${base.replace(/USDT$/, "")}-USDT-SWAP`
        : `${base}-SWAP`;
    };

    const loadTickers = async () => {
      try {
        const data = await fetchLatestTicker(symbols);

        // Fallback per symbol if missing or missing high/low
        const needsFallback = symbols.filter((s) => {
          const info = data[s];
          if (!info) return true;
          const hasHigh = info.high24h !== undefined && Number.isFinite(info.high24h);
          const hasLow = info.low24h !== undefined && Number.isFinite(info.low24h);
          return !hasHigh || !hasLow;
        });

        if (needsFallback.length) {
          const fallbackPairs = await Promise.all(
            needsFallback.map(async (sym) => {
              const instId = symbolToInstId(sym);
              const t = await fetchMarketTicker(instId);
              if (!t) return null;
              return [
                sym,
                {
                  symbol: sym,
                  lastPrice: t.lastPrice,
                  changePercent: t.changePercent,
                  changeAbsolute: t.changeAbsolute,
                  high24h: t.high24h,
                  low24h: t.low24h,
                } as TickerInfo,
              ] as const;
            })
          );

          for (const pair of fallbackPairs) {
            if (pair) {
              const [sym, info] = pair;
              data[sym] = { ...(data[sym] || {}), ...info };
            }
          }
        }

        if (!cancelled) {
          setTickers(data);
        }
      } catch (err) {
        console.warn("⚠️ Failed to fetch tickers:", err);
      }
    };

    loadTickers();
    const id = setInterval(loadTickers, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      {/* HEADER */}
      <header className="relative border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Bot Trading Dashboard</span>
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            Beta
          </span>
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-8 whitespace-nowrap text-[13px]">
          {["BTCUSDT.P", "ETHUSDT.P"].map((sym) => {
            const info = tickers[sym];
            const diffClass =
              info && info.changePercent >= 0
                ? "text-emerald-400"
                : "text-red-400";
            const changeAbs: number | null =
              info && Number.isFinite(info.changeAbsolute)
                ? Number(info.changeAbsolute)
                : info &&
                  Number.isFinite(info.lastPrice) &&
                  Number.isFinite(info.changePercent)
                ? Number(
                    info.lastPrice -
                      info.lastPrice /
                        (1 + Number(info.changePercent || 0) / 100)
                  )
                : null;
            const high24h: number | null =
              info && Number.isFinite(info.high24h)
                ? Number(info.high24h)
                : null;
            const low24h: number | null =
              info && Number.isFinite(info.low24h)
                ? Number(info.low24h)
                : null;
            return (
              <div
                key={sym}
                className="flex items-center gap-3"
              >
                <CoinLogo coin={sym.startsWith("ETH") ? "ETH" : "BTC"} size={18} />
                <span className="text-neutral-50 text-[13px] font-semibold tracking-tight">
                  {sym}
                </span>
                {info ? (
                  <>
                    <span className={`text-sm font-semibold ${diffClass}`}>
                      {info.lastPrice.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className={`${diffClass} text-[12px] font-medium`}>
                      {changeAbs !== null
                        ? `${changeAbs >= 0 ? "+" : ""}${changeAbs.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : ""}
                      {" "}
                      ({info.changePercent.toFixed(2)}%)
                    </span>
                    <span className="text-neutral-500 text-[12px]">High 24h</span>
                    <span className="text-neutral-100 text-[12px] font-medium">
                      {high24h !== null
                        ? high24h.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : "—"}
                    </span>
                    <span className="text-neutral-500 text-[12px]">Low 24h</span>
                    <span className="text-neutral-100 text-[12px] font-medium">
                      {low24h !== null
                        ? low24h.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : "—"}
                    </span>
                  </>
                ) : (
                  <span className="text-neutral-400">loading…</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-neutral-400 flex flex-col items-end">
          <span>VN Timezone (GMT+7)</span>
          {lastUpdated && (
            <span className="text-emerald-400">Last update: {lastUpdated}</span>
          )}
          {fetchError && (
            <span className="text-red-400">Delayed: {fetchError}</span>
          )}
        </div>
      </header>

      {/* MAIN TABS */}
      <div className="px-4 pt-3 flex gap-3 border-b border-neutral-900">
        <button
          onClick={() => setTab("fund")}
          className={`px-3 py-1.5 text-xs rounded-full border ${
            tab === "fund"
              ? "bg-neutral-900 border-neutral-700 text-neutral-100"
              : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
          }`}
        >
          Fund Management
        </button>
        <button
          onClick={() => setTab("bots")}
          className={`px-3 py-1.5 text-xs rounded-full border ${
            tab === "bots"
              ? "bg-neutral-900 border-neutral-700 text-neutral-100"
              : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
          }`}
        >
          Bot List
        </button>
      </div>

      {/* CONTENT */}
      <main className="px-4 py-4">
        <div className={tab === "fund" ? "block" : "hidden"}>
          <FundManagement
            fundMetrics={fundMetrics}
            equityHistory={equityHistory}
            bots={bots}
          />
        </div>
        <div className={tab === "bots" ? "block" : "hidden"}>
          <BotList onBotsUpdated={setBots} />
        </div>
      </main>

      {/* Keep BotList mounted (hidden) to continuously update bots for overview */}
      {tab !== "bots" && (
        <div className="hidden">
          <BotList onBotsUpdated={setBots} />
        </div>
      )}
    </div>
  );
};

export default App;

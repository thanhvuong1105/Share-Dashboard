// src/modules/fund/PnLHistory.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { getApiBase } from "../../api/baseUrl";

export type RangePreset =
  | "7D"
  | "30D"
  | "90D"
  | "180D"
  | "365D"
  | "ALL";

export type ApiTrade = {
  ts: number;
  time: string; // ISO string or formatted open->close
  pnl: number;
  cumulative: number;
  fee?: number;
  side: string;
  instId: string;
  size: number;
  price: number;
  entryPrice?: number;
  exitPrice?: number;
  openTs?: number;
  closeTs?: number;
  algoId?: string;
  botName?: string;
};

export type ApiSummary = {
  totalTrades: number;
  totalPnl: number;
  winrate: number; // 0–1
};

type ApiResponse = {
  range: RangePreset | string;
  summary: ApiSummary;
  trades: ApiTrade[];
};

// Simple in-memory cache để tránh nhảy số khi chuyển tab
type CacheEntry = { trades: ApiTrade[]; summary: ApiSummary; ts: number };
const pnlCache = new Map<string, CacheEntry>();

type PnLHistoryProps = {
  mode?: "portfolio" | "bot";
  algoId?: string; // khi mode="bot"
  botName?: string; // label cho header
  defaultRange?: RangePreset;
};

const API_BASE = getApiBase();

const formatCurrency = (v: number, currency = "USDT") => {
  if (!Number.isFinite(v)) return "-";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return (
    sign +
    Math.abs(Number(v)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " " +
    currency
  );
};

const formatPercent = (v: number, digits = 2) => {
  if (!Number.isFinite(v)) return "-";
  return (v * 100).toFixed(digits) + "%";
};

const PnLHistory: React.FC<PnLHistoryProps> = ({
  defaultRange = "30D",
  mode = "portfolio",
  algoId,
  botName,
}) => {
  // dùng defaultRange làm giá trị khởi tạo, fallback về "30D"
  const initialRange: RangePreset = ([
    "7D",
    "30D",
    "90D",
    "180D",
    "365D",
    "ALL",
  ] as RangePreset[]).includes(defaultRange as RangePreset)
    ? (defaultRange as RangePreset)
    : "30D";

  const [range, setRange] = useState<RangePreset>(initialRange);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<ApiTrade[]>([]);
  const [summary, setSummary] = useState<ApiSummary>({
    totalTrades: 0,
    totalPnl: 0,
    winrate: 0,
  });

  // Sync when parent updates defaultRange
  useEffect(() => {
    const presets: RangePreset[] = [
      "7D",
      "30D",
      "90D",
      "180D",
      "365D",
      "ALL",
    ];
    if (presets.includes(defaultRange as RangePreset)) {
      setRange(defaultRange as RangePreset);
    }
  }, [defaultRange]);

  // Gọi backend lấy dữ liệu PnL (mặc định lấy Signal Bot)
  useEffect(() => {
    let isMounted = true;
    const cacheKey = `${mode}|${algoId || "all"}|${range}`;
    const cacheEntry = pnlCache.get(cacheKey);
    const STALE_MS = 5 * 60 * 1000; // 5 phút
    const isFresh = cacheEntry && Date.now() - cacheEntry.ts < STALE_MS;

    const fetchData = async () => {
      try {
        // nếu có cache, dùng ngay, không chờ fetch
        if (cacheEntry) {
          setTrades(cacheEntry.trades);
          setSummary(cacheEntry.summary);
          setLoading(false);
          if (!isFresh) {
            // fetch nền để cập nhật nhưng không bật spinner
            setError(null);
          } else {
            return;
          }
        } else {
          setLoading(true);
          setError(null);
        }

        // Portfolio: lấy PnL từ Signal Bot (source=signal)
        // Bot cụ thể: thêm algoId để backend gọi history của bot đó
        let url = `${API_BASE}/api/pnl-history?range=${range}&source=signal&algoOrdType=contract`;
        if (mode === "portfolio") {
          url += `&includePositions=1`;
        }
        if (mode === "bot" && algoId) {
          url += `&algoId=${encodeURIComponent(algoId)}`;
        }

        const res = await fetch(url);
        const json = (await res.json()) as any;

        if (!res.ok || (json && json.error)) {
          const msg =
            json?.error ||
            json?.msg ||
            `HTTP ${res.status} – Failed to load PnL history`;
          throw new Error(msg);
        }

        const data = json as ApiResponse;
        const rawTrades = Array.isArray(data.trades) ? data.trades : [];
        const normalized: ApiTrade[] = rawTrades.map((t: any) => ({
          ts: Number(t.ts || 0),
          openTs: Number(t.openTs || t.ts || 0) || undefined,
          closeTs: Number(t.closeTs || t.ts || 0) || undefined,
          time: String(t.time || ""),
          pnl: Number(t.pnl || 0),
          cumulative: Number(t.cumulative || 0),
          fee: t.fee,
          side: String(t.side || ""),
          instId: String(t.instId || ""),
          size: Number(t.size || 0),
          price: Number(t.price || 0),
          entryPrice:
            t.entryPrice !== undefined ? Number(t.entryPrice) : undefined,
          exitPrice:
            t.exitPrice !== undefined ? Number(t.exitPrice) : undefined,
          algoId: t.algoId,
          botName: t.botName,
        }));

        if (isMounted) {
          setTrades(normalized);
          setSummary(
            data.summary || {
              totalTrades: normalized.length,
              totalPnl: normalized.reduce((s, t) => s + t.pnl, 0),
              winrate:
                normalized.length > 0
                  ? normalized.filter((t) => t.pnl > 0).length /
                    normalized.length
                  : 0,
            }
          );
          pnlCache.set(cacheKey, {
            trades: normalized,
            summary:
              data.summary || {
                totalTrades: normalized.length,
                totalPnl: normalized.reduce((s, t) => s + t.pnl, 0),
                winrate:
                  normalized.length > 0
                    ? normalized.filter((t) => t.pnl > 0).length /
                    normalized.length
                    : 0,
              },
            ts: Date.now(),
          });
        }
      } catch (err: any) {
        console.error("❌ Fetch /api/pnl-history error:", err);
        if (!isMounted) return;
        if (cacheEntry) {
          setError(
            (err.message || "Failed to load PnL history") + " (using cache)"
          );
          setLoading(false);
          return;
        }
        setError(err.message || "Failed to load PnL history");
        setTrades([]);
        setSummary({ totalTrades: 0, totalPnl: 0, winrate: 0 });
        setLoading(false);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (mode === "bot" && !algoId) return;

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [range, mode, algoId]);

  // Chuẩn hóa data cho chart
  const chartData = useMemo(
    () =>
      trades.map((t) => ({
        time: new Date(t.closeTs || t.ts).toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
        tradePnl: t.pnl,
        cumulativePnl: t.cumulative,
      })),
    [trades]
  );

  const title =
    mode === "portfolio"
      ? "Portfolio PnL History (All Bots)"
      : `${botName || "Bot"} PnL History`;

  // Table nên hiển thị mới nhất trước (descending), chart giữ nguyên order gốc
  const tableTrades = useMemo(
    () => [...trades].sort((a, b) => b.ts - a.ts),
    [trades]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* HEADER + range */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-neutral-100">{title}</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">
            Total Trades:{" "}
            <span className="text-neutral-100">
              {summary.totalTrades}
            </span>{" "}
            · Winrate:{" "}
            <span className="text-emerald-400">
              {formatPercent(summary.winrate, 2)}
            </span>{" "}
            · Total PnL:{" "}
            <span
              className={
                summary.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
              }
            >
              {formatCurrency(summary.totalPnl)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500">Range</span>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangePreset)}
            className="bg-neutral-900 border border-neutral-700 text-xs rounded-full px-3 py-1.5 text-neutral-200 outline-none"
          >
            <option value="7D">7D</option>
            <option value="30D">30D</option>
            <option value="90D">90D</option>
            <option value="180D">180D</option>
            <option value="365D">365D</option>
            <option value="ALL">All Time</option>
          </select>
        </div>
      </div>

      {/* PNL CHART */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950/40 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900/60 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">PnL Chart</span>
          <span className="text-[11px] text-neutral-500">
            Cumulative PnL / Trade PnL
          </span>
        </div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
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
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: "#d4d4d4" }}
                verticalAlign="top"
                height={24}
              />

              <Line
                type="monotone"
                dataKey="cumulativePnl"
                name="Cumulative PnL"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="tradePnl"
                name="Trade PnL"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TRADES TABLE */}
      <div className="border border-neutral-800 rounded-2xl bg-neutral-950/40 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900/60 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            Trades in Range{" "}
            <span className="text-neutral-100">({range})</span>
          </span>
          {loading && (
            <span className="text-[11px] text-neutral-500">Loading…</span>
          )}
        </div>

        {error ? (
          <div className="px-3 py-4 text-xs text-red-400">{error}</div>
        ) : trades.length === 0 ? (
          <div className="px-3 py-4 text-xs text-neutral-500">
            No PnL data in this range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-neutral-200">
              <thead className="bg-neutral-950/80 border-b border-neutral-800">
                <tr className="text-[11px] text-neutral-400">
                  <th className="px-3 py-2 text-left font-normal">Time</th>
                  <th className="px-3 py-2 text-left font-normal">
                    Symbol / Bot
                  </th>
                  <th className="px-3 py-2 text-left font-normal">
                    Side / Name
                  </th>
                  <th className="px-3 py-2 text-right font-normal">Size</th>
                  <th className="px-3 py-2 text-right font-normal">Entry</th>
                  <th className="px-3 py-2 text-right font-normal">Exit</th>
                  <th className="px-3 py-2 text-right font-normal">PnL</th>
                  <th className="px-3 py-2 text-right font-normal">
                    Cumulative
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableTrades.map((t) => (
                  <tr
                    key={
                      t.ts +
                      "-" +
                      (t.algoId || "") +
                      "-" +
                      t.instId +
                      "-" +
                      t.side
                    }
                    className="border-t border-neutral-900/80 hover:bg-neutral-900/50"
                  >
                    <td className="px-3 py-1.5">
                      {t.openTs && t.closeTs
                        ? `${new Date(t.openTs).toLocaleString("en-GB", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })} → ${new Date(t.closeTs).toLocaleString("en-GB", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : new Date(t.ts).toLocaleString("en-GB", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                    </td>
                    <td className="px-3 py-1.5 text-[11px]">
                      {t.instId || t.algoId || "-"}
                    </td>
                    <td className="px-3 py-1.5 text-[11px]">
                      {t.botName || t.side || "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[11px]">
                      {t.size}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[11px]">
                      {t.entryPrice !== undefined ? t.entryPrice.toFixed(2) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[11px]">
                      {t.exitPrice !== undefined ? t.exitPrice.toFixed(2) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span
                        className={
                          t.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {formatCurrency(t.pnl)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span
                        className={
                          t.cumulative >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {formatCurrency(t.cumulative)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PnLHistory;

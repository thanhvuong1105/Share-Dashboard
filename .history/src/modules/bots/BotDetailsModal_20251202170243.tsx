// src/modules/bots/BotDetailsModal.tsx

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
import { fetchSignalBotHistory, type SignalBotTrade } from "../../okxClient";

const API_BASE =
  (import.meta.env?.VITE_API_BASE || "http://localhost:4000").replace(/\/$/, "");

interface BotDetailsModalProps {
  bot: any; // tạm dùng any, sau này refactor type sau
  onClose: () => void;
}

type LocalRangePreset = "7D" | "30D" | "90D" | "180D" | "365D" | "ALL";
type WrRangePreset = "30D" | "90D" | "180D" | "365D" | "2Y" | "3Y" | "ALL";

const localRangeOptions: LocalRangePreset[] = [
  "7D",
  "30D",
  "90D",
  "180D",
  "365D",
  "ALL",
];

const wrRangeOptions: WrRangePreset[] = [
  "30D",
  "90D",
  "180D",
  "365D",
  "2Y",
  "3Y",
  "ALL",
];

// helper: clamp 0.3–0.8 (30%–80%)
const clampWr = (v: number) => Math.max(0.3, Math.min(0.8, v));

// helper: tính Winrate / High / Low theo range
function calcWr(avgWr: number, range: WrRangePreset) {
  const base = typeof avgWr === "number" && !isNaN(avgWr) ? avgWr : 0.55;

  const mulMap: Record<WrRangePreset, number> = {
    "30D": 1.02,
    "90D": 1.0,
    "180D": 0.99,
    "365D": 0.98,
    "2Y": 0.97,
    "3Y": 0.96,
    ALL: 0.95,
  };

  const mul = mulMap[range] ?? 1.0;
  const wr = clampWr(base * mul);
  const high = clampWr(wr + 0.05);
  const low = clampWr(wr - 0.07);

  return { wr, high, low };
}

const BotDetailsModal: React.FC<BotDetailsModalProps> = ({ bot, onClose }) => {
  // Range riêng cho popup
  const [localRange, setLocalRange] = useState<LocalRangePreset>("30D");

  // Range riêng cho Winrate / High WR / Low WR
  const [wrRangeWin, setWrRangeWin] = useState<WrRangePreset>("30D");
  const [wrRangeHigh, setWrRangeHigh] = useState<WrRangePreset>("30D");
  const [wrRangeLow, setWrRangeLow] = useState<WrRangePreset>("30D");

  // ===== Bảo vệ dữ liệu bot =====
  const totalPnl = typeof bot?.totalPnl === "number" ? bot.totalPnl : 0;
  const maxDd = typeof bot?.maxDd === "number" ? bot.maxDd : -0.2;
  const avgWr = typeof bot?.avgWr === "number" ? bot.avgWr : 0.55;
  const positionPnl =
    typeof bot?.positionPnl === "number" ? bot.positionPnl : 0;
  const winStreakCurrent =
    typeof bot?.winStreakCurrent === "number" ? bot.winStreakCurrent : 0;
  const winStreakMax =
    typeof bot?.winStreakMax === "number" ? bot.winStreakMax : 0;
  const loseStreakCurrent =
    typeof bot?.loseStreakCurrent === "number" ? bot.loseStreakCurrent : 0;
  const loseStreakMax =
    typeof bot?.loseStreakMax === "number" ? bot.loseStreakMax : 0;
  const totalTrades =
    typeof bot?.totalTrades === "number" ? bot.totalTrades : 0;
  const profitFactor =
    typeof bot?.profitFactor === "number" ? bot.profitFactor : 1.5;

  // Entry / Size / Last price (optional)
  const entryPriceFromBot =
    typeof bot?.entryPrice === "number" ? bot.entryPrice : undefined;
  const positionSizeFromBot =
    typeof bot?.positionSize === "number"
      ? bot.positionSize
      : typeof bot?.size === "number"
      ? bot.size
      : undefined;
  const lastPriceFromBot =
    typeof bot?.lastPrice === "number" ? bot.lastPrice : undefined;

  const totalPnlLabel =
    totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2);
  const maxDdLabel = `${(maxDd * 100).toFixed(1)}%`;
  const avgWrLabel = `${(avgWr * 100).toFixed(1)}%`;

  // Tính WR theo từng range riêng
  const wrWin = calcWr(avgWr, wrRangeWin);
  const wrHigh = calcWr(avgWr, wrRangeHigh);
  const wrLow = calcWr(avgWr, wrRangeLow);

  const wrPercent = (wrWin.wr * 100).toFixed(1) + "%";
  const highWrPercent = (wrHigh.high * 100).toFixed(1) + "%";
  const lowWrPercent = (wrLow.low * 100).toFixed(1) + "%";

  const fmtCurrency = (v: number) =>
    (v >= 0 ? "+" : "") + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // === Signal Bot PnL History ===
  const [pnlHistory, setPnlHistory] = useState<SignalBotTrade[]>([]);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | undefined>(
    lastPriceFromBot
  );
  const [positionInfo, setPositionInfo] = useState<{
    avgPx?: number;
    pos?: number;
    posSide?: string;
    pnl?: number;
    markPx?: number;
    last?: number;
  } | null>(null);

  useEffect(() => {
    const algoId = bot?.algoId || bot?.id;
    if (!algoId) return;

    const load = async () => {
      try {
        setPnlLoading(true);
        setPnlError(null);

        // fetch từ backend /api/signal-bot-history qua okxClient
        const { trades } = await fetchSignalBotHistory(algoId);
        setPnlHistory(trades || []);
      } catch (err: any) {
        console.error("❌ fetchSignalBotHistory error:", err);
        setPnlError(err.message || "Failed to load bot PnL history");
        setPnlHistory([]);
      } finally {
        setPnlLoading(false);
      }
    };

    load();
  }, [bot?.algoId, bot?.id]);

  // lấy last price từ backend ticker (public)
  useEffect(() => {
    const instId =
      bot?.instId ||
      (Array.isArray(bot?.instIds) ? bot.instIds[0] : undefined) ||
      undefined;
    if (!instId) return;

    let cancelled = false;
    const fetchTicker = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/market-ticker?instId=${encodeURIComponent(instId)}`
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && typeof json.last === "number") {
          setLastPrice(json.last);
        }
      } catch (err) {
        console.warn("⚠️ fetch ticker failed:", err);
      }
    };
    fetchTicker();
    return () => {
      cancelled = true;
    };
  }, [bot?.instId, bot?.instIds]);

  // derived từ lịch sử trade: size/entry price gần nhất
  const lastTrade = pnlHistory.length
    ? pnlHistory[pnlHistory.length - 1]
    : undefined;
  const entryPrice =
    entryPriceFromBot ||
    (positionInfo?.avgPx && Number(positionInfo.avgPx) > 0
      ? Number(positionInfo.avgPx)
      : undefined) ||
    (lastTrade?.price && Number(lastTrade.price) > 0
      ? Number(lastTrade.price)
      : undefined);
  const positionSize =
    entryPrice !== undefined
      ? positionSizeFromBot ||
        (positionInfo?.pos ? Math.abs(Number(positionInfo.pos)) : undefined) ||
        (lastTrade?.size ? Number(lastTrade.size) : undefined)
      : undefined;

  // Side: chỉ hiển thị Long / Short khi thật sự có position
  const rawPosition =
    typeof bot?.position === "string" ? (bot.position as string) : undefined;
  const hasOpenPosition = rawPosition === "Long" || rawPosition === "Short";
  const openPositionLabel =
    entryPrice !== undefined && hasOpenPosition ? rawPosition : "No open position";

  // lấy position info theo instId để hiện Entry/size chính xác hơn
  useEffect(() => {
    const algoId = bot?.algoId || bot?.id;
    if (!algoId) return;

    let cancelled = false;
    const fetchPos = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/signal-positions?algoId=${encodeURIComponent(algoId)}`
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const pos = Array.isArray(json.positions) ? json.positions[0] : null;
        if (pos) {
          setPositionInfo({
            avgPx: Number(pos.avgPx || 0),
            pos: Number(pos.pos || 0),
            posSide: pos.posSide,
            pnl: Number(pos.pnl || 0),
            markPx: Number(pos.markPx || 0),
            last: Number(pos.last || 0),
          });
          // cập nhật lastPrice nếu có markPx/last
          if (!lastPrice && pos.last) {
            setLastPrice(Number(pos.last));
          } else if (!lastPrice && pos.markPx) {
            setLastPrice(Number(pos.markPx));
          }
        }
      } catch (err) {
        console.warn("⚠️ fetch positions failed:", err);
      }
    };
    fetchPos();
    return () => {
      cancelled = true;
    };
  }, [bot?.algoId, bot?.id, lastPrice]);

  // Dữ liệu cho chart
  const chartData = useMemo(
    () =>
      pnlHistory.map((t) => ({
        time: t.time
          ? t.time
          : t.ts
          ? new Date(t.ts).toLocaleTimeString("en-GB")
          : "",
        pnl: t.pnl,
        cumulative: t.cumulative,
      })),
    [pnlHistory]
  );

  // Lịch sử vị thế đóng (positions history)
  const [posHistory, setPosHistory] = useState<
    {
      instId: string;
      openAvgPx: number;
      closeAvgPx: number;
      pnl: number;
      cTime: number;
      uTime: number;
      closeTs: number;
    }[]
  >([]);
  const [posHistoryError, setPosHistoryError] = useState<string | null>(null);
  useEffect(() => {
    const algoId = bot?.algoId || bot?.id;
    if (!algoId) return;
    let cancelled = false;
    const fetchPosHistory = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/signal-positions-history?algoId=${encodeURIComponent(
            algoId
          )}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(json.data) ? json.data : [];
        setPosHistory(
          rows.map((r: any) => ({
            instId: String(r.instId || ""),
            openAvgPx: Number(r.openAvgPx || 0),
            closeAvgPx: Number(r.closeAvgPx || 0),
            pnl: Number(r.pnl || 0),
            cTime: Number(r.cTime || r.time || 0),
            uTime: Number(r.uTime || 0),
            closeTs: Number(r.uTime || r.closeTime || r.time || 0),
          }))
        );
        setPosHistoryError(null);
      } catch (err: any) {
        if (!cancelled) {
          setPosHistoryError(err.message || "Failed to load positions history");
          setPosHistory([]);
        }
      }
    };
    fetchPosHistory();
    return () => {
      cancelled = true;
    };
  }, [bot?.algoId, bot?.id]);

  // Total trades: số vị thế đã đóng + 1 nếu có vị thế đang mở
  const openPosCount =
    positionInfo && Math.abs(Number(positionInfo.pos || 0)) > 0 ? 1 : 0;
  const totalTradesDisplay =
    posHistory.length > 0 ? posHistory.length + openPosCount : totalTrades;

  return (
    <div className="pointer-events-auto w-[700px] max-h-[85vh] bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl shadow-black/60 flex flex-col overflow-hidden text-[13px]">
      {/* HEADER */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900/70">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-neutral-50">
            {bot?.name ?? "Bot name"}
          </span>
          <span className="text-[12px] text-neutral-400">
            {bot?.symbol ?? "BTCUSDT"} · {bot?.timeframe ?? "M15"} ·{" "}
            {bot?.version ?? "v1.0"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Range riêng cho popup */}
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-neutral-500">Range</span>
            <select
              value={localRange}
              onChange={(e) =>
                setLocalRange(e.target.value as LocalRangePreset)
              }
              className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
            >
              {localRangeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-xs px-2 py-1 rounded-full hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>
      </div>

      {/* BODY */}
      <div className="px-3 py-3 space-y-3 overflow-auto text-[13px] text-neutral-200">
        {/* Summary top row */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[12px] text-neutral-400">Total PnL</div>
            <div
              className={
                totalPnl >= 0
                  ? "text-emerald-400 font-semibold"
                  : "text-red-400 font-semibold"
              }
            >
              {totalPnlLabel}
            </div>
          </div>
          <div>
            <div className="text-[12px] text-neutral-400">Avg WR</div>
            <div className="font-semibold">{avgWrLabel}</div>
          </div>
          <div>
            <div className="text-[12px] text-neutral-400">Profit Factor</div>
            <div className="font-semibold">{profitFactor.toFixed(2)}</div>
          </div>
        </div>

        {/* Drawdown + Position PnL */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-neutral-800 rounded-lg p-2">
            <div className="text-[12px] text-neutral-400 mb-1">Drawdown</div>
            <div className="text-xs text-red-400">Max DD: {maxDdLabel}</div>
            <div className="text-[11px] text-neutral-500 mt-1">
              (Mock – later will be calculated from equity in {localRange})
            </div>
          </div>

          <div className="border border-neutral-800 rounded-lg p-2">
            <div className="text-[12px] text-neutral-400 mb-1">
              Position PnL
            </div>
            <div
              className={
                positionPnl >= 0
                  ? "text-xs text-emerald-400 font-semibold"
                  : "text-xs text-red-400 font-semibold"
              }
            >
              {positionPnl >= 0
                ? `+${positionPnl.toFixed(2)}`
                : positionPnl.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Trading Stats – phía trên Win Rate Details */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[12px] text-neutral-400 mb-1">
            Trading Stats
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-[12px]">
            <span>Total trades:</span>
            <span className="text-right">{totalTradesDisplay}</span>

            <span>Entry price:</span>
            <span className="text-right">
              {entryPrice !== undefined ? entryPrice.toFixed(2) : "-"}
            </span>

            <span>Position size:</span>
            <span className="text-right">
              {positionSize !== undefined ? positionSize.toFixed(3) : "-"}
            </span>

            <span>Last price:</span>
            <span className="text-right">
              {lastPrice !== undefined ? lastPrice.toFixed(2) : "-"}
            </span>

            <span>Side:</span>
            <span className="text-right">{openPositionLabel}</span>

            <span>Status:</span>
            <span className="text-right">{bot?.status ?? "-"}</span>
          </div>
        </div>

        {/* Win Rate Details */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[12px] text-neutral-400 mb-1">
            Win Rate Details
          </div>

          <div className="space-y-1 mt-1">
            {/* Winrate row */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-300 min-w-[70px]">
                Winrate
              </span>
              <select
                value={wrRangeWin}
                onChange={(e) =>
                  setWrRangeWin(e.target.value as WrRangePreset)
                }
                className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
              >
                {wrRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-right text-emerald-400 font-medium text-[12px]">
                {wrPercent}
              </span>
            </div>

            {/* High WR row */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-300 min-w-[70px]">
                High WR
              </span>
              <select
                value={wrRangeHigh}
                onChange={(e) =>
                  setWrRangeHigh(e.target.value as WrRangePreset)
                }
                className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
              >
                {wrRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-right text-emerald-400 text-[12px]">
                {highWrPercent}
              </span>
            </div>

            {/* Low WR row */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-300 min-w-[70px]">
                Low WR
              </span>
              <select
                value={wrRangeLow}
                onChange={(e) =>
                  setWrRangeLow(e.target.value as WrRangePreset)
                }
                className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
              >
                {wrRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-right text-red-400 text-[12px]">
                {lowWrPercent}
              </span>
            </div>
          </div>
        </div>

        {/* Positions History (closed) */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[12px] text-neutral-400 mb-1">
            Positions History (closed)
          </div>
          {posHistoryError ? (
            <div className="text-[12px] text-red-400">
              {posHistoryError}
            </div>
          ) : posHistory.length === 0 ? (
            <div className="text-[12px] text-neutral-500">
              No closed positions for this bot.
            </div>
          ) : (
            <div className="max-h-40 overflow-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="text-left">Inst</th>
                    <th className="text-right">Open Px</th>
                    <th className="text-right">Close Px</th>
                    <th className="text-right">PnL</th>
                    <th className="text-right">Open → Close</th>
                  </tr>
                </thead>
                <tbody>
                  {posHistory.map((p) => (
                    <tr
                      key={p.cTime + p.instId}
                      className="border-t border-neutral-900/70"
                    >
                      <td>{p.instId}</td>
                      <td className="text-right">
                        {p.openAvgPx ? p.openAvgPx.toFixed(2) : "-"}
                      </td>
                      <td className="text-right">
                        {p.closeAvgPx ? p.closeAvgPx.toFixed(2) : "-"}
                      </td>
                      <td
                        className={`text-right ${
                          p.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {p.pnl >= 0 ? `+${p.pnl.toFixed(2)}` : p.pnl.toFixed(2)}
                      </td>
                      <td className="text-right">
                        {p.cTime
                          ? `${new Date(p.cTime).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })} → ${new Date(
                              p.closeTs || p.uTime || p.cTime
                            ).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Win / Lose streak */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[12px] text-neutral-400 mb-1">
            Win / Lose Streak
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-[12px]">
            <span>Current win:</span>
            <span className="text-right text-emerald-400">
              {winStreakCurrent > 0
                ? `+${winStreakCurrent}`
                : winStreakCurrent}
            </span>
            <span>Max win:</span>
            <span className="text-right text-emerald-400">
              {winStreakMax > 0 ? `+${winStreakMax}` : winStreakMax}
            </span>
            <span>Current lose:</span>
            <span className="text-right text-red-400">
              {loseStreakCurrent}
            </span>
            <span>Max lose:</span>
            <span className="text-right text-red-400">
              {loseStreakMax}
            </span>
          </div>
        </div>

        {/* Signal Bot PnL History */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[12px] text-neutral-400">
              Signal Bot PnL History
            </div>
            {pnlLoading && (
              <span className="text-[11px] text-neutral-500">Loading…</span>
            )}
          </div>

          {pnlError ? (
            <div className="text-[12px] text-red-400">{pnlError}</div>
          ) : pnlHistory.length === 0 ? (
            <div className="text-[12px] text-neutral-500">
              No PnL history for this bot.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#171717" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: "#a3a3a3" }}
                      minTickGap={16}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#a3a3a3" }}
                      tickFormatter={(v) => v.toFixed(0)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0a0a0a",
                        border: "1px solid #262626",
                        borderRadius: "0.75rem",
                        fontSize: 12,
                        color: "#e5e5e5",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, color: "#d4d4d4" }}
                      verticalAlign="top"
                      height={18}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      name="Cumulative PnL"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="pnl"
                      name="Trade PnL"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="max-h-40 overflow-auto border border-neutral-800 rounded-lg">
                <table className="min-w-full text-[12px] text-neutral-200">
                  <thead className="bg-neutral-900 text-neutral-400 text-[11px]">
                    <tr>
                      <th className="px-2 py-1 text-left font-normal">Time</th>
                      <th className="px-2 py-1 text-right font-normal">PnL</th>
                      <th className="px-2 py-1 text-right font-normal">
                        Cumulative
                      </th>
                      <th className="px-2 py-1 text-right font-normal">
                        Side
                      </th>
                      <th className="px-2 py-1 text-right font-normal">
                        Size
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnlHistory.map((t) => (
                      <tr
                        key={`${t.ts}-${t.instId || "inst"}-${t.side || "side"}`}
                        className="border-t border-neutral-900/70"
                      >
                        <td className="px-2 py-1">
                          {t.time ||
                            (t.ts
                              ? new Date(t.ts).toLocaleString("en-GB")
                              : "-")}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <span
                            className={
                              t.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                            }
                          >
                            {fmtCurrency(t.pnl)}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <span
                            className={
                              t.cumulative >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            {fmtCurrency(t.cumulative)}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right capitalize">
                          {t.side || "-"}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {t.size ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Note – placeholder cho fund / daily PnL */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[12px] text-neutral-400 mb-1">
            Fund / PnL Daily (todo)
          </div>
          <div className="text-[11px] text-neutral-500">
            Later this section will show daily PnL chart and
            deposit/withdrawal history for this bot, also following the
            selected Range: {localRange}.
          </div>
        </div>
      </div>
    </div>
  );
};

export default BotDetailsModal;

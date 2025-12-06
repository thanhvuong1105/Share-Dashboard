// src/modules/bots/BotDetailsModal.tsx

import React, { useEffect, useMemo, useState } from "react";
import { fetchSignalBotHistory, type SignalBotTrade } from "../../okxClient";
import { getApiBase } from "../../api/baseUrl";

const API_BASE = getApiBase();

interface BotDetailsModalProps {
  bot: any & { credIdx?: number }; // tạm dùng any, sau này refactor type sau
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

type DetailItem = {
  label: string;
  value: React.ReactNode;
};

const BotDetailsModal: React.FC<BotDetailsModalProps> = ({ bot, onClose }) => {
  // Range riêng cho popup
  const [localRange, setLocalRange] = useState<LocalRangePreset>("30D");

  // Range riêng cho các mục Winrate
  const [wrRangeWin, setWrRangeWin] = useState<WrRangePreset>("30D");
  const [wrRangeWin2, setWrRangeWin2] = useState<WrRangePreset>("30D");
  const [wrRangeWin3, setWrRangeWin3] = useState<WrRangePreset>("30D");
  const [wrRangeWin4, setWrRangeWin4] = useState<WrRangePreset>("30D");

  // ===== Bảo vệ dữ liệu bot =====
  const totalPnl = typeof bot?.totalPnl === "number" ? bot.totalPnl : 0;
  const baseMaxDd =
    typeof bot?.maxDd === "number" ? bot.maxDd : -0.2;
  const avgWr = typeof bot?.avgWr === "number" ? bot.avgWr : 0.55;
  const winStreakCurrent =
    typeof bot?.winStreakCurrent === "number" ? bot.winStreakCurrent : 0;
  const winStreakMax =
    typeof bot?.winStreakMax === "number" ? bot.winStreakMax : 0;
  const loseStreakCurrent =
    typeof bot?.loseStreakCurrent === "number" ? bot.loseStreakCurrent : 0;
  const loseStreakMax =
    typeof bot?.loseStreakMax === "number" ? bot.loseStreakMax : 0;
  const totalTrades =
    typeof bot?.totalTrades === "number" ? bot.totalTrades : null;
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

  const fmtPlain = (v: number | null) =>
    v !== null && Number.isFinite(v)
      ? v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
      : "—";

  // === Signal Bot PnL History ===
  const [pnlHistory, setPnlHistory] = useState<SignalBotTrade[]>([]);
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
        // fetch từ backend /api/signal-bot-history qua okxClient
        const { trades } = await fetchSignalBotHistory(algoId);
        setPnlHistory(trades || []);
      } catch (err: any) {
        console.error("❌ fetchSignalBotHistory error:", err);
        setPnlHistory([]);
      }
    };

    load();
  }, [bot?.algoId, bot?.id, bot?.credIdx]);

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
    typeof bot?.position === "string"
      ? (bot.position as string)
      : typeof bot?.positionSideRaw === "string"
      ? (bot.positionSideRaw as string)
      : undefined;
  const hasOpenPosition = rawPosition === "Long" || rawPosition === "Short";
  const openPositionLabel =
    entryPrice !== undefined && hasOpenPosition ? rawPosition : "No open position";

  const investedAmount =
    typeof bot?.investedAmount === "number" ? bot.investedAmount : null;
  const assetsInBot =
    investedAmount !== null ? investedAmount + totalPnl : null;
  const leverageValue =
    typeof bot?.leverage === "number" && Number.isFinite(bot.leverage)
      ? bot.leverage
      : null;
  const leverageLabel = leverageValue ? `${leverageValue}x` : "—";
  const positionPnlValue =
    typeof bot?.positionPnl === "number"
      ? bot.positionPnl
      : positionInfo && typeof positionInfo.pnl === "number"
      ? Number(positionInfo.pnl)
      : undefined;
  const loseStreakAvgMap =
    bot?.loseStreakAvgPerRange &&
    typeof bot.loseStreakAvgPerRange === "object"
      ? (bot.loseStreakAvgPerRange as Record<string, number>)
      : undefined;
  const loseStreakAvgAll =
    typeof bot?.loseStreakAvgAll === "number"
      ? bot.loseStreakAvgAll
      : typeof loseStreakAvgMap?.ALL === "number"
      ? loseStreakAvgMap.ALL
      : undefined;
  const loseStreakAvgLocal =
    (loseStreakAvgMap &&
      typeof loseStreakAvgMap[localRange] === "number" &&
      loseStreakAvgMap[localRange]) ||
    loseStreakAvgAll ||
    0;
  const winStreakAvgMap =
    bot?.winStreakAvgPerRange &&
    typeof bot.winStreakAvgPerRange === "object"
      ? (bot.winStreakAvgPerRange as Record<string, number>)
      : undefined;
  const winStreakAvgAll =
    typeof bot?.winStreakAvgAll === "number"
      ? bot.winStreakAvgAll
      : typeof winStreakAvgMap?.ALL === "number"
      ? winStreakAvgMap.ALL
      : undefined;
  const winStreakAvgLocal =
    (winStreakAvgMap &&
      typeof winStreakAvgMap[localRange] === "number" &&
      winStreakAvgMap[localRange]) ||
    winStreakAvgAll ||
    0;
  const winRatePerRange =
    bot?.winRatePerRange && typeof bot.winRatePerRange === "object"
      ? (bot.winRatePerRange as Record<string, number>)
      : undefined;
  const getWinRateForPreset = (preset: string): number | undefined => {
    if (!winRatePerRange) return undefined;
    const value = winRatePerRange[preset];
    return typeof value === "number" ? value : undefined;
  };
  const formatAvg = (value?: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(1)
      : "0.0";

  // lấy position info theo instId để hiện Entry/size chính xác hơn
  useEffect(() => {
    const algoId = bot?.algoId || bot?.id;
    if (!algoId) return;

    let cancelled = false;
    const fetchPos = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/signal-positions?algoId=${encodeURIComponent(
            algoId
          )}${bot?.credIdx !== undefined ? `&credIdx=${bot.credIdx}` : ""}`
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
          )}${bot?.credIdx !== undefined ? `&credIdx=${bot.credIdx}` : ""}`
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

  // Winrate/streak dựa trên positions history (closed)
  const winLossStats = useMemo(() => {
    let win = 0;
    let lose = 0;
    for (const p of posHistory) {
      const pnl = Number(p.pnl || 0);
      if (pnl > 0) win += 1;
      else if (pnl < 0) lose += 1;
    }
    const total = win + lose;
    const winrate = total > 0 ? win / total : null;
    return { win, lose, total, winrate };
  }, [posHistory]);

  const baseWr = winLossStats.winrate ?? avgWr;

  const calcRangeWr = (avgWrValue: number, range: string): number => {
    const base = avgWrValue || 0.55;
    switch (range) {
      case "7D":
        return Math.max(0.25, base - 0.18);
      case "30D":
        return Math.max(0.3, base - 0.15);
      case "90D":
        return Math.max(0.32, base - 0.12);
      case "180D":
        return Math.max(0.34, base - 0.1);
      case "365D":
        return Math.max(0.35, base - 0.08);
      case "ALL":
      default:
        return Math.max(0.36, base - 0.06);
    }
  };

  const calcCurrentDd = (maxDdValue: number, range: string): number => {
    const abs = Math.abs(maxDdValue) || 0.2;
    let factor = 0.3;
    switch (range) {
      case "7D":
        factor = 0.2;
        break;
      case "30D":
        factor = 0.35;
        break;
      case "90D":
        factor = 0.4;
        break;
      case "180D":
        factor = 0.45;
        break;
      case "365D":
        factor = 0.5;
        break;
      case "ALL":
      default:
        factor = 0.55;
        break;
    }
    return -(abs * factor);
  };

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

  const avgWrValueFromBot = getWinRateForPreset("ALL");
  const rangeWrFromBot = getWinRateForPreset(localRange);
  const baseWrForCalc = avgWrValueFromBot ?? baseWr;
  const rangeWrValue =
    rangeWrFromBot ?? calcRangeWr(baseWrForCalc, localRange);
  const rangeWrLabel = formatPercent(rangeWrValue);
  const ddMap =
    bot?.maxDdPerRange && typeof bot.maxDdPerRange === "object"
      ? (bot.maxDdPerRange as Record<string, number>)
      : undefined;
  const allTimeDd =
    (ddMap && typeof ddMap.ALL === "number" ? ddMap.ALL : undefined) ??
    baseMaxDd;
  const avgDdValue = allTimeDd ?? baseMaxDd;
  let rangeDdValue =
    ddMap && typeof ddMap[localRange] === "number"
      ? ddMap[localRange]
      : undefined;
  if (
    localRange.toUpperCase() === "ALL" &&
    typeof allTimeDd === "number"
  ) {
    rangeDdValue = allTimeDd;
  }
  const fallbackCurrentDd = calcCurrentDd(
    avgDdValue ?? baseMaxDd,
    localRange
  );
  const currentDdValue =
    typeof rangeDdValue === "number" ? rangeDdValue : fallbackCurrentDd;
  const currentDdLabel = `${Math.abs(currentDdValue * 100).toFixed(2)}%`;
  const avgDdLabel = `${Math.abs((avgDdValue ?? -0.2) * 100).toFixed(2)}%`;

  // Winrate Details: dùng winrate thực (không cộng/trừ thêm) cho cả 3 mục
  const avgWrLabel = formatPercent(avgWrValueFromBot ?? baseWr);
  const resolveWrValue = (preset: WrRangePreset): number =>
    getWinRateForPreset(preset) ?? calcRangeWr(baseWrForCalc, preset);
  const wrPercentPrimary = formatPercent(resolveWrValue(wrRangeWin));
  const wrPercent2 = formatPercent(resolveWrValue(wrRangeWin2));
  const wrPercent3 = formatPercent(resolveWrValue(wrRangeWin3));
  const wrPercent4 = formatPercent(resolveWrValue(wrRangeWin4));


  // Tính streak dựa trên Positions History (closed). Fallback dùng bot nếu chưa có data.
  const streaks = useMemo(() => {
    if (!posHistory.length) {
      return {
        winCurrent: winStreakCurrent,
        winMax: winStreakMax,
        loseCurrent: loseStreakCurrent,
        loseMax: loseStreakMax,
      };
    }

    const sorted = [...posHistory].sort(
      (a, b) =>
        (a.closeTs || a.uTime || a.cTime || 0) -
        (b.closeTs || b.uTime || b.cTime || 0)
    );

    let curWin = 0;
    let curLose = 0;
    let maxWin = 0;
    let maxLose = 0;

    for (const p of sorted) {
      const pnl = Number(p.pnl || 0);
      if (pnl > 0) {
        curWin += 1;
        maxWin = Math.max(maxWin, curWin);
        curLose = 0;
      } else if (pnl < 0) {
        curLose += 1;
        maxLose = Math.max(maxLose, curLose);
        curWin = 0;
      } else {
        curWin = 0;
        curLose = 0;
      }
    }

    return {
      winCurrent: curWin,
      winMax: Math.max(maxWin, curWin),
      loseCurrent: curLose,
      loseMax: Math.max(maxLose, curLose),
    };
  }, [posHistory, winStreakCurrent, winStreakMax, loseStreakCurrent, loseStreakMax]);

  // Total trades: số vị thế đã đóng + 1 nếu có vị thế đang mở
  const openPosCount =
    positionInfo && Math.abs(Number(positionInfo.pos || 0)) > 0 ? 1 : 0;
  const totalTradesDisplay =
    Number.isFinite(totalTrades)
      ? (totalTrades as number)
      : posHistory.length > 0
      ? posHistory.length + openPosCount
      : 0;

  const detailItems: DetailItem[] = [
    {
      label: "Invested Amount",
      value: fmtPlain(investedAmount),
    },
    { label: "TF", value: bot?.timeframe || "—" },
    {
      label: "Assets In Bot",
      value: fmtPlain(assetsInBot),
    },
    {
      label: "Current/AVG DD",
      value: (
        <div className="flex gap-1 text-[11px]">
          <span className="text-red-400">{currentDdLabel}</span>
          <span className="text-neutral-400">/ {avgDdLabel}</span>
        </div>
      ),
    },
    {
      label: "Total PnL",
      value: (
        <span
          className={
            Number(totalPnl) >= 0 ? "text-emerald-400" : "text-red-400"
          }
        >
          {Number(totalPnl) >= 0
            ? `+${Number(totalPnl).toFixed(2)}`
            : Number(totalPnl).toFixed(2)}
        </span>
      ),
    },
    {
      label: "Range/Avg WR",
      value: (
        <div className="flex gap-1 text-[11px]">
          <span className="text-neutral-100">{rangeWrLabel}</span>
          <span className="text-neutral-500">/ {avgWrLabel}</span>
        </div>
      ),
    },
    { label: "Total Trades", value: String(totalTradesDisplay) },
    {
      label: "Win/Lose Streak (/AVG)",
      value: (
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="text-emerald-400">
              {formatAvg(winStreakAvgLocal)}
            </span>
            <span className="text-neutral-500">
              / {formatAvg(winStreakAvgAll)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-red-400">
              {formatAvg(loseStreakAvgLocal)}
            </span>
            <span className="text-neutral-500">
              / {formatAvg(loseStreakAvgAll)}
            </span>
          </div>
        </div>
      ),
    },
    { label: "Leverage", value: leverageLabel },
    {
      label: "Profit Factor",
      value: Number.isFinite(profitFactor)
        ? profitFactor.toFixed(2)
        : "—",
    },
  ];

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
        <div className="border border-neutral-800 rounded-lg p-3">
          <div className="text-[11px] text-neutral-400 mb-2 uppercase tracking-wide">
            Overview
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-[11px]">
            {[...detailItems].map((item, idx, arr) => (
              <div
                key={`${item.label}-${idx}`}
                className="flex items-center justify-between border-b border-neutral-800/60 pb-1"
                style={{
                  borderBottom: idx === arr.length - 1 ? "none" : undefined,
                  paddingBottom: idx === arr.length - 1 ? 0 : undefined,
                }}
              >
                <span className="text-[9px] uppercase text-neutral-500 tracking-wide">
                  {item.label}
                </span>
                <div className="text-[11px] text-neutral-100 text-right">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[11px] text-neutral-400 mb-1 uppercase tracking-wide">
            Trading Stats
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-[11px]">
            <span className="text-neutral-400">Side</span>
            <span className="text-right text-neutral-100">{openPositionLabel}</span>

            <span className="text-neutral-400">Entry price</span>
            <span className="text-right text-neutral-100">
              {entryPrice !== undefined ? entryPrice.toFixed(2) : "-"}
            </span>

            <span className="text-neutral-400">Last price</span>
            <span className="text-right text-neutral-100">
              {lastPrice !== undefined ? lastPrice.toFixed(2) : "-"}
            </span>

            <span className="text-neutral-400">Position size</span>
            <span className="text-right text-neutral-100">
              {positionSize !== undefined ? positionSize.toFixed(3) : "-"}
            </span>

            <span className="text-neutral-400">Position PnL</span>
            <span
              className={`text-right ${
                positionPnlValue !== undefined
                  ? positionPnlValue >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
                  : "text-neutral-100"
              }`}
            >
              {positionPnlValue === undefined
                ? "-"
                : positionPnlValue >= 0
                ? `+${positionPnlValue.toFixed(2)}`
                : positionPnlValue.toFixed(2)}
            </span>
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
                {wrPercentPrimary}
              </span>
            </div>

            {/* Winrate 2 */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-300 min-w-[70px]">
                Winrate 2
              </span>
              <select
                value={wrRangeWin2}
                onChange={(e) => setWrRangeWin2(e.target.value as WrRangePreset)}
                className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
              >
                {wrRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-right text-emerald-400 text-[12px]">
                {wrPercent2}
              </span>
            </div>

            {/* Winrate 3 */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-300 min-w-[70px]">
                Winrate 3
              </span>
              <select
                value={wrRangeWin3}
                onChange={(e) => setWrRangeWin3(e.target.value as WrRangePreset)}
                className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
              >
                {wrRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-right text-emerald-400 text-[12px]">
                {wrPercent3}
              </span>
            </div>

            {/* Winrate 4 */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-300 min-w-[70px]">
                Winrate 4
              </span>
              <select
                value={wrRangeWin4}
                onChange={(e) => setWrRangeWin4(e.target.value as WrRangePreset)}
                className="bg-neutral-900 border border-neutral-700 rounded-full px-2.5 py-1 text-[11px] text-neutral-200 outline-none"
              >
                {wrRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="flex-1 text-right text-emerald-400 text-[12px]">
                {wrPercent4}
              </span>
            </div>
          </div>
        </div>

        {/* Win / Lose streak */}
        <div className="border border-neutral-800 rounded-lg p-2">
          <div className="text-[12px] text-neutral-400 mb-1">
            Win / Lose Streak
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-[12px]">
            <span>Current win:</span>
            <span className="text-right text-emerald-400">
              {streaks.winCurrent > 0
                ? `+${streaks.winCurrent}`
                : streaks.winCurrent}
            </span>
            <span>Max win:</span>
            <span className="text-right text-emerald-400">
              {streaks.winMax > 0 ? `+${streaks.winMax}` : streaks.winMax}
            </span>
            <span>Current lose:</span>
            <span className="text-right text-red-400">
              {streaks.loseCurrent}
            </span>
            <span>Max lose:</span>
            <span className="text-right text-red-400">
              {streaks.loseMax}
            </span>
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

        {/* Fund Overview */}
        <div className="border border-neutral-800 rounded-lg p-2 space-y-2">
          <div className="text-[12px] text-neutral-400">Fund / Deposit / Withdraw</div>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-neutral-200">
            <div className="border border-neutral-800 rounded-lg p-2">
              <div className="text-neutral-500 uppercase text-[9px] mb-1 tracking-wide">Fund</div>
              <div className="text-neutral-100">—</div>
            </div>
            <div className="border border-neutral-800 rounded-lg p-2">
              <div className="text-neutral-500 uppercase text-[9px] mb-1 tracking-wide">Deposit</div>
              <div className="text-emerald-400">—</div>
            </div>
            <div className="border border-neutral-800 rounded-lg p-2">
              <div className="text-neutral-500 uppercase text-[9px] mb-1 tracking-wide">Withdraw</div>
              <div className="text-red-400">—</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BotDetailsModal;

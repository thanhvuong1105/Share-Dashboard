import React, { useEffect, useState } from "react";
import BotTable, { type Bot, type BotPositionHistoryEntry } from "./BotTable";
import BotDetailsModal from "./BotDetailsModal";
import { getApiBase } from "../../api/baseUrl";
import { fetchSignalBotHistory, type SignalBotTrade } from "../../okxClient";

type CoinTab = "BTC" | "ETH";
type RangePreset = "7D" | "30D" | "90D" | "180D" | "365D" | "ALL";

const API_BASE = getApiBase();
const RANGE_PRESETS: RangePreset[] = ["7D", "30D", "90D", "180D", "365D", "ALL"];
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_TO_MS: Record<RangePreset, number | null> = {
  "7D": 7 * DAY_MS,
  "30D": 30 * DAY_MS,
  "90D": 90 * DAY_MS,
  "180D": 180 * DAY_MS,
  "365D": 365 * DAY_MS,
  ALL: null,
};

type HistoryEntry = { pnl: number; ts: number };

const normalizeHistoryEntries = (
  rows: Array<{ pnl?: number; cTime?: number; uTime?: number; closeTs?: number }>
): HistoryEntry[] =>
  rows
    .map((row) => ({
      pnl: Number(row.pnl || 0),
      ts: Number(row.closeTs || row.uTime || row.cTime || 0),
    }))
    .filter((item) => Number.isFinite(item.pnl) && Number.isFinite(item.ts) && item.ts > 0)
    .sort((a, b) => a.ts - b.ts);

const calcAvgForRange = (
  entries: HistoryEntry[],
  maxAgeMs: number | null,
  now: number,
  predicate: (pnl: number) => boolean
) => {
  let sequences: number[] = [];
  let cur = 0;
  for (const entry of entries) {
    if (maxAgeMs !== null && now - entry.ts > maxAgeMs) {
      continue;
    }
    if (predicate(entry.pnl)) {
      cur += 1;
    } else {
      if (cur > 0) {
        sequences.push(cur);
        cur = 0;
      }
    }
  }
  if (cur > 0) sequences.push(cur);
  if (!sequences.length) return 0;
  return sequences.reduce((sum, item) => sum + item, 0) / sequences.length;
};

const calcWinRateForRange = (
  entries: HistoryEntry[],
  maxAgeMs: number | null,
  now: number
) => {
  let win = 0;
  let total = 0;
  for (const entry of entries) {
    if (maxAgeMs !== null && now - entry.ts > maxAgeMs) {
      continue;
    }
    if (entry.pnl > 0) {
      win += 1;
      total += 1;
    } else if (entry.pnl < 0) {
      total += 1;
    }
  }
  if (total === 0) return 0;
  return win / total;
};

const calcDrawdownForRange = (
  series: { ts: number; equity: number }[],
  maxAgeMs: number | null,
  now: number
) => {
  const filtered =
    maxAgeMs === null ? series : series.filter((pt) => now - pt.ts <= maxAgeMs);
  if (!filtered.length) return 0;
  let peak = filtered[0].equity;
  let maxDd = 0;
  for (const pt of filtered) {
    if (pt.equity > peak) {
      peak = pt.equity;
    }
    if (peak > 0) {
      const dd = (pt.equity - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd;
};

const calcRangeStats = (entries: HistoryEntry[], baseEquity: number) => {
  const now = Date.now();
  const lose: Record<RangePreset, number> = {} as Record<RangePreset, number>;
  const win: Record<RangePreset, number> = {} as Record<RangePreset, number>;
  const winRate: Record<RangePreset, number> = {} as Record<RangePreset, number>;
  const equitySeries: { ts: number; equity: number }[] = [];
  let cumulative = 0;
  let peakEquity = baseEquity;
  let maxDrawdown = 0;
  for (const entry of entries) {
    cumulative += entry.pnl;
    const equity = baseEquity + cumulative;
    equitySeries.push({ ts: entry.ts, equity });
    if (equity > peakEquity) {
      peakEquity = equity;
    }
    if (peakEquity > 0) {
      const dd = (equity - peakEquity) / peakEquity;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }
  RANGE_PRESETS.forEach((preset) => {
    const limit = RANGE_TO_MS[preset];
    lose[preset] = calcAvgForRange(entries, limit, now, (pnl) => pnl < 0);
    win[preset] = calcAvgForRange(entries, limit, now, (pnl) => pnl > 0);
    winRate[preset] = calcWinRateForRange(entries, limit, now);
  });
  const drawdownPerRange: Record<RangePreset, number> =
    {} as Record<RangePreset, number>;
  RANGE_PRESETS.forEach((preset) => {
    const limit = RANGE_TO_MS[preset];
    drawdownPerRange[preset] = calcDrawdownForRange(
      equitySeries,
      limit,
      now
    );
  });
  return { lose, win, winRate, drawdownPerRange, maxDrawdown };
};

// Tính win/lose streak + drawdown từ lịch sử vị thế đã đóng
const computeStreakFromHistory = (
  rows: Array<{ pnl?: number; cTime?: number; uTime?: number; closeTs?: number }>,
  initialEquity?: number,
  investedAmount?: number
) => {
  if (!rows.length) return null;
  const entries = normalizeHistoryEntries(rows);
  if (!entries.length) return null;

  let curWin = 0;
  let curLose = 0;
  let maxWin = 0;
  let maxLose = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const baseEquity =
    typeof initialEquity === "number" && initialEquity > 0
      ? initialEquity
      : typeof investedAmount === "number" && investedAmount > 0
      ? investedAmount
      : 1;
  for (const entry of entries) {
    if (entry.pnl > 0) {
      grossProfit += entry.pnl;
      curWin += 1;
      maxWin = Math.max(maxWin, curWin);
      curLose = 0;
    } else if (entry.pnl < 0) {
      grossLoss += Math.abs(entry.pnl);
      curLose += 1;
      maxLose = Math.max(maxLose, curLose);
      curWin = 0;
    } else {
      curWin = 0;
      curLose = 0;
    }
  }

  const {
    lose: loseAvgPerRange,
    win: winAvgPerRange,
    winRate: winRatePerRange,
    drawdownPerRange,
    maxDrawdown,
  } = calcRangeStats(entries, baseEquity);
  const totalClosedPnl = entries.reduce((sum, entry) => sum + entry.pnl, 0);

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
      ? Number.POSITIVE_INFINITY
      : 0;

  return {
    winCurrent: curWin,
    winMax: Math.max(maxWin, curWin),
    loseCurrent: curLose,
    loseMax: Math.max(maxLose, curLose),
    loseAvgPerRange,
    winAvgPerRange,
    winRatePerRange,
    maxDrawdown,
    maxDrawdownPerRange: drawdownPerRange,
    totalClosedPnl,
    profitFactor,
  };
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type FetchJsonResult = { json: any; status: number; ok: boolean };

const fetchJsonWithRetry = async (
  url: string,
  init?: RequestInit,
  retries = 2,
  backoffMs = 1200
): Promise<FetchJsonResult> => {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      const isRateLimited =
        res.status === 429 || json?.code === "50011" || json?.msg === "Too Many Requests";
      if (isRateLimited && attempt < retries) {
        attempt += 1;
        await sleep(backoffMs * attempt);
        continue;
      }
      return { json, status: res.status, ok: res.ok };
    } catch (err) {
      if (attempt < retries) {
        attempt += 1;
        await sleep(backoffMs * attempt);
        continue;
      }
      throw err;
    }
  }
};

const normalizeTimestamp = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
};

type NormalizedStreakRow = {
  pnl: number;
  cTime: number;
  uTime: number;
  closeTs: number;
};

const normalizeStreakRows = (rows: any[]): NormalizedStreakRow[] =>
  rows.map((r: any) => ({
    pnl: Number(r.pnl || 0),
    cTime: normalizeTimestamp(r.cTime || r.time || r.closeTs),
    uTime: normalizeTimestamp(r.uTime),
    closeTs: normalizeTimestamp(
      r.closeTs || r.uTime || r.closeTime || r.time || r.cTime
    ),
  }));

const toPositionHistoryEntries = (
  rows: NormalizedStreakRow[]
): BotPositionHistoryEntry[] =>
  rows
    .map((row) => ({
      pnl: row.pnl,
      closeTs: row.closeTs || row.uTime || row.cTime,
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.pnl) &&
        Number.isFinite(entry.closeTs) &&
        entry.closeTs > 0
    )
    .sort((a, b) => a.closeTs - b.closeTs);

type BotListProps = {
  onBotsUpdated?: (bots: Bot[]) => void;
};

const BotList: React.FC<BotListProps> = ({ onBotsUpdated }) => {
  const ENABLE_BG_TRADES = true; // bật lấy tổng trades cho Bot List
  const ENABLE_BG_STREAKS = true;
  const ENABLE_BG_OPEN_POS = true; // bật lấy position + invested amount
  const [coinTab, setCoinTab] = useState<CoinTab>("BTC");
  const [range, setRange] = useState<RangePreset>("30D");
  const [openBots, setOpenBots] = useState<Bot[]>([]);

  const [allBots, setAllBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // lấy trạng thái vị thế đang mở cho từng bot
  const loadOpenPositions = async (bots: Bot[]) => {
    const patches: Record<
      string,
      {
        hasOpenPosition: boolean;
        positionPnl?: number;
        position?: "Long" | "Short" | "None";
        positionSideRaw?: "Long" | "Short" | "None";
        entryPrice?: number | null;
      }
    > = {};

    for (const b of bots) {
      if (!b.algoId) continue;
      try {
        const { json } = await fetchJsonWithRetry(
          `${API_BASE}/api/signal-positions?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        if (json?.code === "50011" || json?.msg === "Too Many Requests") {
          console.warn(`⚠️ Rate limited open positions for ${b.algoId}, continue next`);
          continue;
        }
        const positions = Array.isArray(json.positions) ? json.positions : [];
        let hasOpen = false;
        let positionSide: "Long" | "Short" | "None" = "None";
        let posPnl: number | undefined = undefined;

        const deriveSide = (p: any): "Long" | "Short" | "None" => {
          if (!p) return "None";
          const posSide = String(p.posSide || p.direction || "").toLowerCase();
          if (posSide.includes("long")) return "Long";
          if (posSide.includes("short")) return "Short";
          const size = Number(p.pos || p.totalPos || 0);
          if (Number.isFinite(size) && Math.abs(size) > 0) {
            return size > 0 ? "Long" : "Short";
          }
          return "None";
        };

        const openPosition = positions.find((p: any) => {
          const side = deriveSide(p);
          if (side === "None") return false;
          const size = Number(p.pos || p.totalPos || 0);
          return Number.isFinite(size) && Math.abs(size) > 0;
        }) || positions.find((p: any) => deriveSide(p) !== "None");

        let entryPrice: number | null = null;
        if (openPosition) {
          positionSide = deriveSide(openPosition);
          hasOpen = positionSide !== "None";
          posPnl = Number(openPosition.pnl || openPosition.floatPnl || 0);
          const entry = Number(
            openPosition.avgPx ||
              openPosition.openAvgPx ||
              openPosition.entryPx ||
              openPosition.avgPrice ||
              0
          );
          entryPrice = Number.isFinite(entry) && entry > 0 ? entry : null;
        }

        patches[b.algoId!] = {
          hasOpenPosition: hasOpen,
          positionPnl: posPnl !== undefined ? posPnl : b.positionPnl,
          position: positionSide,
          positionSideRaw: positionSide,
          entryPrice,
        };
      } catch (err) {
        console.warn(`⚠️ loadOpenPositions failed for ${b.algoId}:`, err);
      }
      await sleep(400);
    }

    if (Object.keys(patches).length) {
      setAllBots((prev) =>
        prev.map((bot) =>
          patches[bot.id] ? { ...bot, ...patches[bot.id] } : bot
        )
      );
    }
  };

  // lấy invested amount (orders details)
  const loadInvestedAmount = async (bots: Bot[]) => {
    const patches: Record<
      string,
      { investedAmount: number; leverage?: number | null; assetsInBot?: number }
    > = {};

    for (const b of bots) {
      if (!b.algoId) continue;
      try {
        const { json } = await fetchJsonWithRetry(
          `${API_BASE}/api/signal-orders-details?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        if (json?.code === "50011" || json?.msg === "Too Many Requests") {
          console.warn(`⚠️ Rate limited invested for ${b.algoId}, continue next`);
          continue;
        }
        const row = Array.isArray(json.data) ? json.data[0] : null;
        if (row) {
          const invested = Number(row.investAmt || row.investedAmt || 0);
          const lev = Number(
            row.lever ??
            row.leverage ??
            row.leveraged ??
            row.leverVal ??
            row.leverageVal ??
            0
          );
          patches[b.algoId!] = {
            investedAmount: isFinite(invested) ? invested : 0,
            assetsInBot:
              Number(row.availBal || 0) + Number(row.frozenBal || 0) || 0,
            leverage: Number.isFinite(lev) && lev > 0 ? lev : null,
          };
        }
      } catch (err) {
        console.warn(`⚠️ loadInvestedAmount failed for ${b.algoId}:`, err);
      }
      await sleep(400);
    }

    if (Object.keys(patches).length) {
      setAllBots((prev) =>
        prev.map((bot) =>
          patches[bot.id] ? { ...bot, ...patches[bot.id] } : bot
        )
      );
    }
  };

  // lấy tổng trades từ backend (positions-history + open pos)
  const loadTradesCount = async (bots: Bot[]) => {
    const patches: Record<
      string,
      { totalTrades: number; totalTradesClosed?: number; totalTradesOpen?: number }
    > = {};
    const seen = new Set<string>();
    const patchKeyFor = (bot: Bot) =>
      bot.credIdx !== undefined ? `${bot.algoId}::${bot.credIdx}` : bot.algoId;
    for (const b of bots) {
      if (!b.algoId) continue;
      const patchKey = patchKeyFor(b);
      if (patchKey && seen.has(patchKey)) continue;
      if (patchKey) seen.add(patchKey);
      try {
        const { json, ok } = await fetchJsonWithRetry(
          `${API_BASE}/api/bot-trades?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        if (json?.code === "50011" || json?.msg === "Too Many Requests") {
          console.warn(`⚠️ Rate limited trades for ${b.algoId}, continue next`);
          continue;
        }
        if (ok && typeof json.total === "number") {
          patches[patchKey || b.algoId!] = {
            totalTrades: Number(json.total),
            totalTradesClosed: Number(json.closed ?? 0),
            totalTradesOpen: Number(json.open ?? 0),
          };
        }
      } catch (err) {
        console.warn(`⚠️ loadTradesCount failed for ${b.algoId}:`, err);
      }
      await sleep(400);
    }

    if (Object.keys(patches).length) {
      setAllBots((prev) =>
        prev.map((bot) => {
          const pk =
            bot.credIdx !== undefined ? `${bot.id}::${bot.credIdx}` : bot.id;
          return patches[pk] ? { ...bot, ...patches[pk] } : bot;
        })
      );
    }
  };

  // lấy streak từ positions-history (closed) cho từng bot
  const convertTradesToRows = (trades: SignalBotTrade[]) =>
    trades.map((t) => {
      const tsRaw =
        typeof t.ts === "number" && t.ts > 0
          ? Number(t.ts)
          : t.time
          ? Date.parse(t.time)
          : NaN;
      const safeTs = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : Date.now();
      return {
        pnl: Number(t.pnl || 0),
        closeTs: safeTs,
        cTime: safeTs,
        uTime: safeTs,
      };
    });

  const loadStreaks = async (bots: Bot[]) => {
    const patches: Record<
      string,
      {
        winStreakCurrent: number;
        winStreakMax: number;
        loseStreakCurrent: number;
        loseStreakMax: number;
        loseStreakAvgAll?: number;
        loseStreakAvgPerRange?: Record<string, number>;
        winStreakAvgAll?: number;
        winStreakAvgPerRange?: Record<string, number>;
        winRatePerRange?: Record<string, number>;
        maxDd?: number;
        maxDdPerRange?: Record<string, number>;
        closedPnlAllTime?: number;
        profitFactor?: number;
        positionHistory?: BotPositionHistoryEntry[];
      }
    > = {};

    for (const b of bots) {
      if (!b.algoId) continue;
      try {
        const { json, ok, status } = await fetchJsonWithRetry(
          `${API_BASE}/api/signal-positions-history?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        if (json?.code === "50011" || json?.msg === "Too Many Requests") {
          console.warn(`⚠️ Rate limited streaks for ${b.algoId}, continue next`);
          continue;
        }
        if (!ok) throw new Error(`HTTP ${status}`);
        let rows = Array.isArray(json.data) ? json.data : [];
        if ((!rows || rows.length === 0) && b.algoId) {
          try {
            const history = await fetchSignalBotHistory(b.algoId);
            rows = convertTradesToRows(history.trades || []);
          } catch (historyErr) {
            console.warn(
              `⚠️ fallback signal history failed for ${b.algoId}:`,
              historyErr
            );
          }
        }
        const normalizeRows = normalizeStreakRows(rows);
        const positionHistory = toPositionHistoryEntries(normalizeRows);

        const baseEquity =
          typeof b.assetsInBot === "number" && b.assetsInBot > 0
            ? b.assetsInBot
            : typeof b.investedAmount === "number" && b.investedAmount > 0
            ? b.investedAmount
            : undefined;
        const streak = computeStreakFromHistory(
          normalizeRows,
          baseEquity,
          b.investedAmount ?? undefined
        );
        if (streak) {
          patches[b.algoId!] = {
            winStreakCurrent: streak.winCurrent,
            winStreakMax: streak.winMax,
            loseStreakCurrent: streak.loseCurrent,
            loseStreakMax: streak.loseMax,
            loseStreakAvgAll:
              typeof streak.loseAvgPerRange?.ALL === "number"
                ? streak.loseAvgPerRange.ALL
                : undefined,
            loseStreakAvgPerRange: streak.loseAvgPerRange,
            winStreakAvgAll:
              typeof streak.winAvgPerRange?.ALL === "number"
                ? streak.winAvgPerRange.ALL
                : undefined,
            winStreakAvgPerRange: streak.winAvgPerRange,
            winRatePerRange: streak.winRatePerRange,
            maxDd:
              typeof streak.maxDrawdown === "number"
                ? streak.maxDrawdown
                : undefined,
            maxDdPerRange: streak.maxDrawdownPerRange,
            closedPnlAllTime: streak.totalClosedPnl ?? 0,
            ...(typeof streak.profitFactor === "number"
              ? { profitFactor: streak.profitFactor }
              : {}),
            positionHistory,
          };
        }
      } catch (err) {
        console.warn(`⚠️ loadStreaks failed for ${b.algoId}:`, err);
        if (b.algoId) {
          try {
            const history = await fetchSignalBotHistory(b.algoId);
            const rows = convertTradesToRows(history.trades || []);
            const normalizedFallbackRows = normalizeStreakRows(rows);
            const fallbackPositionHistory =
              toPositionHistoryEntries(normalizedFallbackRows);
            const baseEquity =
              typeof b.assetsInBot === "number" && b.assetsInBot > 0
                ? b.assetsInBot
                : typeof b.investedAmount === "number" && b.investedAmount > 0
                ? b.investedAmount
                : undefined;
            const fallbackStreak = computeStreakFromHistory(
              normalizedFallbackRows,
              baseEquity,
              b.investedAmount ?? undefined
            );
            if (fallbackStreak) {
              patches[b.algoId!] = {
                winStreakCurrent: fallbackStreak.winCurrent,
                winStreakMax: fallbackStreak.winMax,
                loseStreakCurrent: fallbackStreak.loseCurrent,
                loseStreakMax: fallbackStreak.loseMax,
                loseStreakAvgAll:
                  typeof fallbackStreak.loseAvgPerRange?.ALL === "number"
                    ? fallbackStreak.loseAvgPerRange.ALL
                    : undefined,
                loseStreakAvgPerRange: fallbackStreak.loseAvgPerRange,
                winStreakAvgAll:
                  typeof fallbackStreak.winAvgPerRange?.ALL === "number"
                    ? fallbackStreak.winAvgPerRange.ALL
                    : undefined,
                winStreakAvgPerRange: fallbackStreak.winAvgPerRange,
                winRatePerRange: fallbackStreak.winRatePerRange,
                maxDd:
                  typeof fallbackStreak.maxDrawdown === "number"
                    ? fallbackStreak.maxDrawdown
                    : undefined,
                maxDdPerRange: fallbackStreak.maxDrawdownPerRange,
                closedPnlAllTime: fallbackStreak.totalClosedPnl ?? 0,
                ...(typeof fallbackStreak.profitFactor === "number"
                  ? { profitFactor: fallbackStreak.profitFactor }
                  : {}),
                positionHistory: fallbackPositionHistory,
              };
            }
          } catch (fallbackErr) {
            console.warn(
              `⚠️ fallback signal history (catch) failed for ${b.algoId}:`,
              fallbackErr
            );
          }
        }
      }
      await sleep(400);
    }

    if (Object.keys(patches).length) {
      setAllBots((prev) =>
        prev.map((bot) =>
          patches[bot.id] ? { ...bot, ...patches[bot.id] } : bot
        )
      );
    }
  };

  // ===== FETCH ACTIVE SIGNAL BOTS TỪ BACKEND =====
  useEffect(() => {
    const fetchBots = async () => {
      try {
        setLoading(true);
        setError(null);

        // gọi backend proxy: /api/signal-active-bots
        const res = await fetch(
          `${API_BASE}/api/signal-active-bots?algoOrdType=contract&limit=100`
        );
        const json = await res.json();

        if (!res.ok || json.code !== "0" || !Array.isArray(json.data)) {
          console.error("❌ Error from /api/signal-active-bots:", json);
          setError(json?.msg || json?.error || "Failed to load bots from OKX");
          setAllBots([]);
          return;
        }

        // Map từ Signal Bot đang active → Bot type dùng cho BotTable
        const mapped: Bot[] = json.data.map((row: any, idx: number) => {
          const algoId = String(row.algoId);
          const rawName = String(row.signalChanName || `Signal Bot #${idx + 1}`);

          const instIds: string[] = Array.isArray(row.instIds)
            ? row.instIds
            : [];
          const firstInst = instIds[0] || "";
          const instType = String(row.instType || "SWAP");

          // ví dụ: BTC-USDT-SWAP → BTCUSDT
          const symbol =
            firstInst.indexOf("-") > -1
              ? firstInst.replace(/-/g, "")
              : firstInst || "BTCUSDT";

          // đoán side: nếu tên chứa "short" → Short, còn lại Long
          const lowerName = rawName.toLowerCase();
          const side: "Long" | "Short" = lowerName.includes("short")
            ? "Short"
            : "Long";

          // status dựa theo state
          const state = String(row.state || "").toLowerCase();
          const status =
            state === "running" || state === "live" ? "Running" : "Stopped";

          const totalPnl = Number(row.totalPnl || 0);
          const floatPnl = Number(row.floatPnl || 0);
          const realizedPnl = Number(row.realizedPnl || 0);
          const leverageValue = Number(
            row.lever ?? row.leverage ?? row.leveraged ?? 0
          );

          // Những field chưa có từ API, tạm mock / default
          const bot: Bot = {
            id: algoId, // dùng algoId làm id duy nhất
            // @ts-ignore: nếu Bot chưa có field này thì đã được mở rộng ở BotTable
            algoId, // lưu lại để sau này gọi /api/signal-bot-history
            // @ts-ignore giữ credIdx để gọi đúng sub-account
            credIdx: typeof row.credIdx === "number" ? row.credIdx : undefined,
            name: rawName,
            version: "", // có thể parse từ name sau
            timeframe: "30m", // gán cố định theo yêu cầu
            status,
            symbol,
            instId: firstInst || undefined,
            instType,
            side,
            totalTrades: 0, // sau này có thể tính từ history
            totalTradesClosed: 0,
            totalTradesOpen: 0,
            totalPnl: totalPnl, // PnL tổng của bot
            avgWr: 0.55, // tạm default
            maxDd: -0.2, // tạm default
            maxDdPerRange: {},
            profitFactor: 1.5, // tạm default
            // ưu tiên PnL của lệnh đang mở (floatPnl), fallback realizedPnl
            positionPnl: Number.isFinite(floatPnl) ? floatPnl : realizedPnl,
            winStreakCurrent: 0,
            winStreakMax: 0,
            // các field streak thua nếu có trong type
            // @ts-ignore
            loseStreakCurrent: 0,
            // @ts-ignore
            loseStreakMax: 0,
            hasOpenPosition: false,
            investedAmount: Number(row.investAmt || row.investedAmt || 0) || 0,
            assetsInBot:
              Number(row.availBal || 0) + Number(row.frozenBal || 0) || 0,
            leverage: Number.isFinite(leverageValue) ? leverageValue : null,
            loseStreakAvgAll: null,
            loseStreakAvgPerRange: {},
            winStreakAvgAll: null,
            winStreakAvgPerRange: {},
            winRatePerRange: {},
            closedPnlAllTime: 0,
            positionHistory: [],
          };

          return bot;
        });

        setAllBots(mapped);
        // chạy song song, nhưng không chặn UI (tùy chọn)
        if (ENABLE_BG_TRADES) {
          loadTradesCount(mapped);
        }
        if (ENABLE_BG_STREAKS) {
          loadStreaks(mapped);
        }
        if (ENABLE_BG_OPEN_POS) {
          loadOpenPositions(mapped);
        }
        // lấy invested amount từ orders-algo-details
        loadInvestedAmount(mapped);

      } catch (err) {
        console.error("❌ /api/signal-active-bots fetch error:", err);
        setError("Failed to fetch bots");
        setAllBots([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBots();
  }, []);

  // reload streaks định kỳ (mỗi 60s) để cập nhật cho bot mới load chậm
  useEffect(() => {
    if (!ENABLE_BG_STREAKS) return;
    if (!allBots.length) return;
    loadStreaks(allBots);
    const timer = setInterval(() => {
      loadStreaks(allBots);
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [allBots, ENABLE_BG_STREAKS]);

  // ===== TÁCH BTC / ETH DỰA VÀO SYMBOL =====
  const btcBots = allBots.filter((b) => b.symbol.toUpperCase().includes("BTC"));
  const ethBots = allBots.filter((b) => b.symbol.toUpperCase().includes("ETH"));

  const bots = coinTab === "BTC" ? btcBots : ethBots;

  const handleOpenBot = (bot: Bot) => {
    setOpenBots((prev) =>
      prev.find((b) => b.id === bot.id) ? prev : [...prev, bot]
    );
  };

  const defaultPopupPosition = (index: number) => {
    const viewportWidth =
      typeof window !== "undefined" ? window.innerWidth : 1280;
    const baseX = Math.max(20, viewportWidth - 760);
    return {
      x: baseX - index * 24,
      y: 80 + index * 32,
    };
  };

  const handleCloseBot = (id: string) => {
    setOpenBots((prev) => prev.filter((b) => b.id !== id));
  };

  useEffect(() => {
    onBotsUpdated?.(allBots);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("bots-updated", { detail: allBots })
      );
    }
  }, [allBots, onBotsUpdated]);

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Mini tab BTC / ETH + Range */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setCoinTab("BTC")}
              className={`px-3 py-1.5 text-xs rounded-full border ${
                coinTab === "BTC"
                  ? "bg-neutral-800 border-neutral-600"
                  : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
              }`}
            >
              Bitcoin
            </button>
            <button
              onClick={() => setCoinTab("ETH")}
              className={`px-3 py-1.5 text-xs rounded-full border ${
                coinTab === "ETH"
                  ? "bg-neutral-800 border-neutral-600"
                  : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
              }`}
            >
              Ethereum
            </button>
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

        {/* Loading / Error */}
        {loading && (
          <div className="text-xs text-neutral-400">
            Loading bots from OKX...
          </div>
        )}
        {error && !loading && (
          <div className="text-xs text-red-400">
            {error} – using empty list.
          </div>
        )}

        {/* Table */}
        <BotTable
          bots={bots}
          coinTab={coinTab}
          range={range}
          onBotDoubleClick={handleOpenBot}
        />
      </div>

      {/* Popups – có thể mở nhiều bot */}
      <div className="pointer-events-none fixed inset-0 z-40">
        {openBots.map((bot, idx) => (
          <BotDetailsModal
            key={bot.id}
            bot={bot}
            onClose={() => handleCloseBot(bot.id)}
            initialPosition={defaultPopupPosition(idx)}
          />
        ))}
      </div>
    </>
  );
};

export default BotList;

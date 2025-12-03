import React, { useEffect, useState } from "react";
import BotTable, { type Bot } from "./BotTable";
import BotDetailsModal from "./BotDetailsModal";
import { getApiBase } from "../../api/baseUrl";

type CoinTab = "BTC" | "ETH";
type RangePreset = "7D" | "30D" | "90D" | "180D" | "365D" | "ALL";

const API_BASE = getApiBase();

// Tính win/lose streak từ lịch sử vị thế đã đóng
const computeStreakFromHistory = (
  rows: Array<{ pnl?: number; cTime?: number; uTime?: number; closeTs?: number }>
) => {
  if (!rows.length) return null;

  const sorted = [...rows].sort(
    (a, b) =>
      (a.closeTs || a.uTime || a.cTime || 0) -
      (b.closeTs || b.uTime || b.cTime || 0)
  );

  let curWin = 0;
  let curLose = 0;
  let maxWin = 0;
  let maxLose = 0;

  for (const r of sorted) {
    const pnl = Number(r.pnl || 0);
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
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type BotListProps = {
  onBotsUpdated?: (bots: Bot[]) => void;
};

const BotList: React.FC<BotListProps> = ({ onBotsUpdated }) => {
  const ENABLE_BG_TRADES = true; // bật lấy tổng trades cho Bot List
  const ENABLE_BG_STREAKS = false;
  const ENABLE_BG_OPEN_POS = true; // bật lấy position + invested amount
  const [coinTab, setCoinTab] = useState<CoinTab>("BTC");
  const [range, setRange] = useState<RangePreset>("30D");
  const [openBots, setOpenBots] = useState<Bot[]>([]);

  const [allBots, setAllBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const mergeBotFields = (algoId: string, patch: Partial<Bot>) => {
    setAllBots((prev) =>
      prev.map((b) => (b.id === algoId ? { ...b, ...patch } : b))
    );
  };

  // lấy trạng thái vị thế đang mở cho từng bot
  const loadOpenPositions = async (bots: Bot[]) => {
    const patches: Record<
      string,
      { hasOpenPosition: boolean; positionPnl?: number }
    > = {};

    for (const b of bots) {
      if (!b.algoId) continue;
      try {
        const res = await fetch(
          `${API_BASE}/api/signal-positions?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok && json?.code === "50011") {
          console.warn(`⚠️ Rate limited open positions for ${b.algoId}, continue next`);
          continue;
        }
        const positions = Array.isArray(json.positions) ? json.positions : [];
        const hasOpen = positions.some(
          (p: any) => Math.abs(Number(p.pos || 0)) > 0
        );
        const posPnl = positions.length
          ? Number(positions[0]?.pnl || positions[0]?.floatPnl || 0)
          : undefined;
        patches[b.algoId!] = {
          hasOpenPosition: hasOpen,
          positionPnl: posPnl !== undefined ? posPnl : b.positionPnl,
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
    const patches: Record<string, { investedAmount: number }> = {};

    for (const b of bots) {
      if (!b.algoId) continue;
      try {
        const res = await fetch(
          `${API_BASE}/api/signal-orders-details?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok && json?.code === "50011") {
          console.warn(`⚠️ Rate limited invested for ${b.algoId}, continue next`);
          continue;
        }
        const row = Array.isArray(json.data) ? json.data[0] : null;
        if (row) {
        const invested = Number(row.investAmt || row.investedAmt || 0);
          patches[b.algoId!] = {
            investedAmount: isFinite(invested) ? invested : 0,
            assetsInBot:
              Number(row.availBal || 0) + Number(row.frozenBal || 0) || 0,
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
    const patches: Record<string, { totalTrades: number }> = {};
    const seen = new Set<string>();
    for (const b of bots) {
      if (!b.algoId) continue;
      if (seen.has(b.algoId)) continue;
      seen.add(b.algoId);
      try {
        const res = await fetch(
          `${API_BASE}/api/bot-trades?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok && json?.code === "50011") {
          console.warn(`⚠️ Rate limited trades for ${b.algoId}, continue next`);
          continue;
        }
        if (res.ok && typeof json.total === "number") {
          patches[b.algoId!] = { totalTrades: Number(json.total) };
        }
      } catch (err) {
        console.warn(`⚠️ loadTradesCount failed for ${b.algoId}:`, err);
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

  // lấy streak từ positions-history (closed) cho từng bot
  const loadStreaks = async (bots: Bot[]) => {
    const patches: Record<
      string,
      {
        winStreakCurrent: number;
        winStreakMax: number;
        loseStreakCurrent: number;
        loseStreakMax: number;
      }
    > = {};

    for (const b of bots) {
      if (!b.algoId) continue;
      try {
        const res = await fetch(
          `${API_BASE}/api/signal-positions-history?algoId=${encodeURIComponent(
            b.algoId!
          )}${b.credIdx !== undefined ? `&credIdx=${b.credIdx}` : ""}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok && json?.code === "50011") {
          console.warn(`⚠️ Rate limited streaks for ${b.algoId}, continue next`);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = Array.isArray(json.data) ? json.data : [];
        const streak = computeStreakFromHistory(rows);
        if (streak) {
          patches[b.algoId!] = {
            winStreakCurrent: streak.winCurrent,
            winStreakMax: streak.winMax,
            loseStreakCurrent: streak.loseCurrent,
            loseStreakMax: streak.loseMax,
          };
        }
      } catch (err) {
        console.warn(`⚠️ loadStreaks failed for ${b.algoId}:`, err);
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
            totalPnl: totalPnl, // PnL tổng của bot
            avgWr: 0.55, // tạm default
            maxDd: -0.2, // tạm default
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

  const handleCloseBot = (id: string) => {
    setOpenBots((prev) => prev.filter((b) => b.id !== id));
  };

  useEffect(() => {
    onBotsUpdated?.(allBots);
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

      {/* Popups – có thể mở nhiều bot, cố định góc phải */}
      <div className="pointer-events-none fixed inset-y-20 right-4 z-40 flex flex-col items-end gap-3">
        {openBots.map((bot) => (
          <BotDetailsModal
            key={bot.id}
            bot={bot}
            onClose={() => handleCloseBot(bot.id)}
          />
        ))}
      </div>
    </>
  );
};

export default BotList;

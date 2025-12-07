import React from "react";

export type BotPositionHistoryEntry = {
  pnl: number;
  closeTs: number;
};

export type Bot = {
  id: string;
  algoId?: string;
  name: string;
  version: string;
  timeframe: string;
  status: string;
  symbol: string;
  instId?: string;
  instType?: string;
  side: "Long" | "Short";
  totalTrades: number;
  totalPnl: number;
  avgWr: number; // 0–1
  maxDd: number; // âm, ví dụ -0.2 = -20%
  profitFactor: number;
  positionPnl: number;
  winStreakCurrent: number;
  winStreakMax: number;
  loseStreakCurrent: number;
  loseStreakMax: number;
  hasOpenPosition?: boolean;
  credIdx?: number;
  investedAmount?: number | null;
  assetsInBot?: number | null;
  totalTradesClosed?: number;
  totalTradesOpen?: number;
  leverage?: number | null;
  position?: "Long" | "Short" | "None";
  entryPrice?: number | null;
  loseStreakAvgAll?: number | null;
  loseStreakAvgPerRange?: Record<string, number>;
  winStreakAvgAll?: number | null;
  winStreakAvgPerRange?: Record<string, number>;
  winRatePerRange?: Record<string, number>;
  maxDdPerRange?: Record<string, number>;
  closedPnlAllTime?: number;
  positionHistory?: BotPositionHistoryEntry[];
};

interface BotTableProps {
  bots: Bot[];
  coinTab: "BTC" | "ETH";
  range: string;
  onBotDoubleClick: (bot: Bot) => void;
}

const getBotTotalTrades = (bot: Bot) => {
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

function calcCurrentDd(maxDd: number, range: string): number {
  const abs = Math.abs(maxDd) || 0.2;
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
}

// ===== TÍNH PF PORTFOLIO CHUẨN TỪ PF TỪNG BOT + PnL =====
function calcPortfolioProfitFactor(bots: Bot[]): number {
  let grossProfitTotal = 0;
  let grossLossTotal = 0;

  for (const b of bots) {
    const pf = b.profitFactor;
    const net = b.totalPnl;

    if (!isFinite(pf) || !isFinite(net) || pf <= 0 || pf === 1) continue;

    // Net = G - L, PF = G / L => L = Net / (PF - 1)
    const L = net / (pf - 1);
    if (!isFinite(L) || L === 0) continue;

    const lossAbs = Math.abs(L);
    const profit = lossAbs * pf;

    grossLossTotal += lossAbs;
    grossProfitTotal += profit;
  }

  if (grossLossTotal === 0) return 0;
  return grossProfitTotal / grossLossTotal;
}

const BotTable: React.FC<BotTableProps> = ({
  bots,
  coinTab,
  range,
  onBotDoubleClick,
}) => {
  const formatPercent = (value?: number | null) =>
    typeof value === "number" && Number.isFinite(value)
      ? `${(value * 100).toFixed(1)}%`
      : "0%";
  // ===== SUMMARY CALCULATIONS =====
  const totalTrades = bots.reduce((s, b) => s + getBotTotalTrades(b), 0);
  const totalPnl = bots.reduce((s, b) => s + b.totalPnl, 0);
  const totalPnlLabel =
    totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2);

  const totalInvested = bots.reduce((s, b) => s + (b.investedAmount ?? 0), 0);
  const totalAssets = bots.reduce(
    (s, b) => s + (b.investedAmount ?? 0) + (b.totalPnl ?? 0),
    0
  );
  const totalInvestedLabel = totalInvested
    ? totalInvested.toFixed(2)
    : "—";
  const totalAssetsLabel = totalAssets ? totalAssets.toFixed(2) : "—";

  const positionPnlTotal = bots.reduce((s, b) => s + b.positionPnl, 0);
  const positionPnlTotalLabel =
    positionPnlTotal >= 0
      ? `+${positionPnlTotal.toFixed(2)}`
      : positionPnlTotal.toFixed(2);

  // PF portfolio chuẩn
  const totalPF = calcPortfolioProfitFactor(bots);

  return (
    <div className="border border-neutral-800 rounded-2xl bg-neutral-950/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900/60">
        <span className="text-[11px] text-neutral-400">
          Bot List · {coinTab} · Range{" "}
          <span className="text-neutral-200">{range}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs text-neutral-200">
          <thead className="bg-neutral-950/80 border-b border-neutral-800">
            <tr className="text-[11px] text-neutral-400">
              <th className="px-3 py-2 text-left font-normal">Bot</th>
              <th className="px-3 py-2 text-center font-normal">
                Invested Amount
              </th>
              <th className="px-3 py-2 text-center font-normal">
                Assets In Bot
              </th>
              <th className="px-3 py-2 text-center font-normal">Total PnL</th>
              <th className="px-3 py-2 text-center font-normal">TF</th>
              <th className="px-3 py-2 text-center font-normal">Leverage</th>
              <th className="px-3 py-2 text-center font-normal">Entry Price</th>
              <th className="px-3 py-2 text-center font-normal">Position</th>
              <th className="px-3 py-2 text-center">Position PnL</th>
              <th className="px-3 py-2 text-center">Total Trades</th>
              <th className="px-3 py-2 text-center">Range/Avg WR</th>
              <th className="px-3 py-2 text-center">Current/AVG DD</th>
              <th className="px-3 py-2 text-center">Win/Lose Streak (/AVG)</th>
              <th className="px-3 py-2 text-center">Profit Factor</th>
            </tr>
          </thead>

          <tbody>
            {bots.map((bot) => {
              const ddMap = bot.maxDdPerRange || {};
              const allTimeDd =
                (ddMap && typeof ddMap.ALL === "number" ? ddMap.ALL : undefined) ??
                (typeof bot.maxDd === "number" ? bot.maxDd : undefined);
              const avgDdValue = allTimeDd ?? (typeof bot.maxDd === "number" ? bot.maxDd : 0);
              let currentDdValue =
                typeof ddMap[range] === "number" ? ddMap[range] : undefined;
              if (range.toUpperCase() === "ALL") {
                currentDdValue = allTimeDd ?? currentDdValue;
              }
              if (currentDdValue === undefined) {
                currentDdValue = calcCurrentDd(avgDdValue, range);
              }
              const currentDdAbs = Math.abs(
                Number((currentDdValue * 100).toFixed(2))
              );
              const maxDdAbs = Math.abs(
                Number((avgDdValue * 100).toFixed(2))
              );
              const leverageValue = Number(bot.leverage ?? 0);
              const leverageLabel = Number.isFinite(leverageValue) && leverageValue > 0
                ? `${leverageValue}x`
                : "—";
              const entryPriceValue = Number(bot.entryPrice ?? 0);
              const entryPriceLabel =
                Number.isFinite(entryPriceValue) && entryPriceValue !== 0
                  ? entryPriceValue.toFixed(2)
                  : "—";
              const positionLabel = bot.position
                ? bot.position
                : bot.hasOpenPosition
                ? bot.side
                : "None";
              const profitFactorValue = Number(bot.profitFactor);
              const profitFactorLabel = Number.isFinite(profitFactorValue)
                ? profitFactorValue.toFixed(2)
                : profitFactorValue === Number.POSITIVE_INFINITY
                ? "∞"
                : "—";
              const positionPnlClass =
                bot.positionPnl === 0
                  ? "text-neutral-100"
                  : bot.positionPnl > 0
                  ? "text-emerald-400"
                  : "text-red-400";
              const winCurrent =
                typeof bot.winStreakCurrent === "number" &&
                Number.isFinite(bot.winStreakCurrent)
                  ? Math.round(bot.winStreakCurrent)
                  : 0;
              const loseCurrent =
                typeof bot.loseStreakCurrent === "number" &&
                Number.isFinite(bot.loseStreakCurrent)
                  ? Math.round(bot.loseStreakCurrent)
                  : 0;
              const winMax =
                typeof bot.winStreakMax === "number" &&
                Number.isFinite(bot.winStreakMax)
                  ? Math.round(bot.winStreakMax)
                  : winCurrent;
              const loseMax =
                typeof bot.loseStreakMax === "number" &&
                Number.isFinite(bot.loseStreakMax)
                  ? Math.round(bot.loseStreakMax)
                  : loseCurrent;
              const winRateMap = bot.winRatePerRange || {};
              const rangeWrValue =
                typeof winRateMap[range] === "number"
                  ? winRateMap[range]
                  : typeof winRateMap.ALL === "number"
                  ? winRateMap.ALL
                  : 0;
              const avgWrValue =
                typeof winRateMap.ALL === "number"
                  ? winRateMap.ALL
                  : rangeWrValue;

              return (
                <tr
                  key={bot.id}
                  className="border-t border-neutral-900/80 hover:bg-neutral-900/50 cursor-pointer"
                  onDoubleClick={() => onBotDoubleClick(bot)}
                >
                  {/* Bot */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-[12px] text-neutral-50">
                        {bot.name}
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        {bot.version} · {bot.symbol}
                      </span>
                    </div>
                  </td>

                  {/* Invested Amount */}
                  <td className="px-3 py-2 text-center text-xs text-neutral-200">
                    {bot.investedAmount !== undefined &&
                    bot.investedAmount !== null
                      ? bot.investedAmount.toFixed(2)
                      : "—"}
                  </td>

                  {/* Assets In Bot */}
                  <td className="px-3 py-2 text-center text-xs text-neutral-200">
                    {((bot.investedAmount ?? 0) + (bot.totalPnl ?? 0)).toFixed(2)}
                  </td>

                  {/* Total PnL */}
                  <td className="px-3 py-2 text-center">
                    <span
                      className={
                        bot.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }
                    >
                      {bot.totalPnl >= 0
                        ? `+${bot.totalPnl.toFixed(2)}`
                        : bot.totalPnl.toFixed(2)}
                    </span>
                  </td>

                  {/* Timeframe */}
                  <td className="px-3 py-2 text-[11px] text-center">
                    {bot.timeframe}
                  </td>

                  {/* Leverage */}
                  <td className="px-3 py-2 text-center text-xs text-neutral-200">
                    {leverageLabel}
                  </td>

                  {/* Entry Price */}
                  <td className="px-3 py-2 text-center text-xs text-neutral-200">
                    {entryPriceLabel}
                  </td>

                  {/* Position (side) */}
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        positionLabel === "Long"
                          ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                          : positionLabel === "Short"
                          ? "border-red-500/40 text-red-300 bg-red-500/5"
                          : "border-neutral-600 text-neutral-300"
                      }`}
                    >
                      {positionLabel}
                    </span>
                  </td>

                  {/* Position PnL */}
                  <td className="px-3 py-2 text-center">
                    <span className={positionPnlClass}>
                      {bot.positionPnl > 0
                        ? `+${bot.positionPnl.toFixed(2)}`
                        : bot.positionPnl.toFixed(2)}
                    </span>
                  </td>

                  {/* Total Trades */}
                  <td className="px-3 py-2 text-center">
                    {getBotTotalTrades(bot)}
                  </td>

                  {/* Range / Avg WR */}
                  <td className="px-3 py-2 text-center">
                    <div className="text-[11px] text-neutral-100 flex justify-center gap-1">
                      <span>{formatPercent(rangeWrValue)}</span>
                      <span>/ {formatPercent(avgWrValue)}</span>
                    </div>
                  </td>

                  {/* Current / Max DD */}
                  <td className="px-3 py-2 text-center">
                    <div className="text-[11px] flex justify-center gap-1 text-red-400">
                      <span>{currentDdAbs}%</span>
                      <span>/ {maxDdAbs}%</span>
                    </div>
                  </td>

                  {/* Win / Lose Streak */}
                  <td className="px-3 py-2 text-center">
                    <div className="text-[11px] flex items-center justify-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-emerald-400">
                          {winCurrent}
                        </span>
                        <span className="text-neutral-500">
                          / {winMax}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-red-400">
                          {loseCurrent}
                        </span>
                        <span className="text-neutral-500">
                          / {loseMax}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Profit Factor */}
                  <td className="px-3 py-2 text-center">
                    {profitFactorLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t border-neutral-800 bg-neutral-900/70 text-[12px] text-neutral-100">
              <td className="px-3 py-2 font-semibold text-neutral-50">Total</td>
              <td className="px-3 py-2 text-center text-xs text-neutral-200">
                {totalInvestedLabel}
              </td>
              <td className="px-3 py-2 text-center text-[11px] text-neutral-200">
                {totalAssetsLabel}
              </td>
              <td className="px-3 py-2 text-center">
                <span
                  className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
                >
                  {totalPnlLabel}
                </span>
              </td>
              <td className="px-3 py-2 text-center text-[11px] text-neutral-200">
                —
              </td>
              <td className="px-3 py-2 text-center text-[11px] text-neutral-200">
                —
              </td>
              <td className="px-3 py-2 text-center text-[11px] text-neutral-200">
                —
              </td>
              <td className="px-3 py-2 text-center text-[11px] text-neutral-200">
                —
              </td>
              <td className="px-3 py-2 text-center">
                <span
                  className={
                    positionPnlTotal >= 0 ? "text-emerald-400" : "text-red-400"
                  }
                >
                  {positionPnlTotalLabel}
                </span>
              </td>
              <td className="px-3 py-2 text-center text-neutral-200">
                {totalTrades}
              </td>
              <td className="px-3 py-2 text-center">
                <div className="flex justify-center gap-1 text-neutral-100">
                  <span>0%</span>
                  <span>/0%</span>
                </div>
              </td>
              <td className="px-3 py-2 text-center">
                <div className="flex justify-center gap-1 text-red-400">
                  <span>0.07%</span>
                  <span>/ 20%</span>
                </div>
              </td>
              <td className="px-3 py-2 text-center">
                <div className="text-[11px] text-neutral-200">—</div>
              </td>
              <td className="px-3 py-2 text-center text-neutral-200">
                {totalPF.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default BotTable;

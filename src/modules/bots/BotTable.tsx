import React from "react";

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
};

interface BotTableProps {
  bots: Bot[];
  coinTab: "BTC" | "ETH";
  range: string;
  onBotDoubleClick: (bot: Bot) => void;
}

const fmtPercent = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const formatSigned = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function calcRangeWr(avgWr: number, range: string): number {
  const base = avgWr || 0.55;

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
}

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
  // ===== SUMMARY CALCULATIONS =====
  const totalTrades = bots.reduce((s, b) => s + b.totalTrades, 0);
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
              <th className="px-3 py-2 text-center font-normal">TF</th>
              <th className="px-3 py-2 text-center font-normal">Status</th>
              <th className="px-3 py-2 text-center font-normal">Position</th>
              <th className="px-3 py-2 text-center">Position PnL</th>
              <th className="px-3 py-2 text-center">Total PnL</th>
              <th className="px-3 py-2 text-center">Total Trades</th>
              <th className="px-3 py-2 text-center">Range/Avg WR</th>
              <th className="px-3 py-2 text-center">Current/MAX DD</th>
              <th className="px-3 py-2 text-center">Win/Lose Streak</th>
              <th className="px-3 py-2 text-center">Profit Factor</th>
            </tr>
          </thead>

          <tbody>
            {bots.map((bot) => {
              const rangeWr = calcRangeWr(bot.avgWr, range);
              const avgWr = fmtPercent(bot.avgWr, 0);
              const rangeWrLabel = fmtPercent(calcRangeWr(bot.avgWr, range));
              const currentDd = calcCurrentDd(bot.maxDd, range);
              const currentDdAbs = Math.abs(Number(currentDd.toFixed(2)));
              const maxDdAbs = Math.abs(Number((bot.maxDd * 100).toFixed(2)));
              const positionPnlClass =
                bot.positionPnl === 0
                  ? "text-neutral-100"
                  : bot.positionPnl > 0
                  ? "text-emerald-400"
                  : "text-red-400";

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

                  {/* Timeframe */}
                  <td className="px-3 py-2 text-[11px] text-center">
                    {bot.timeframe}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        bot.status === "Running"
                          ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                          : "border-neutral-600 text-neutral-300"
                      }`}
                    >
                      {bot.status}
                    </span>
                  </td>

                  {/* Position (side) */}
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        bot.side === "Long"
                          ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                          : "border-red-500/40 text-red-300 bg-red-500/5"
                      }`}
                    >
                      {bot.side}
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

                  {/* Total Trades */}
                  <td className="px-3 py-2 text-center">{bot.totalTrades}</td>

                  {/* Range / Avg WR */}
                  <td className="px-3 py-2 text-center">
                    <div className="text-[11px] text-neutral-100 flex justify-center gap-1">
                      <span>{rangeWrLabel}</span>
                      <span>/ {avgWr}</span>
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
                    <div className="text-[11px] flex items-center justify-center gap-2">
                      <span className="text-emerald-400">
                        {bot.winStreakCurrent} / {bot.winStreakMax}
                      </span>
                      <span className="text-red-400">
                        {bot.loseStreakCurrent} / {bot.loseStreakMax}
                      </span>
                    </div>
                  </td>

                  {/* Profit Factor */}
                  <td className="px-3 py-2 text-center">
                    {bot.profitFactor.toFixed(2)}
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
              <td className="px-3 py-2 text-center">
                <span
                  className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
                >
                  {totalPnlLabel}
                </span>
              </td>
              <td className="px-3 py-2 text-center text-neutral-200">
                {totalTrades}
              </td>
              <td className="px-3 py-2 text-center">
                <div className="flex justify-center gap-1 text-neutral-100">
                  <span>40%</span>
                  <span>/ 55%</span>
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

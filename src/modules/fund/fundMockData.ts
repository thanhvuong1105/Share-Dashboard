// src/modules/fund/fundMockData.ts

//---------------------------------------------------------
// 1) Daily Snapshot (Mock raw history from OKX)
//---------------------------------------------------------
export interface FundDailySnapshot {
  date: string;        // "2025-11-28"
  equity: number;      // Total equity
  balance: number;     // Realized balance
  dailyPnl: number;    // PnL trong ngày
  currentDd?: number;  // drawdown hiện tại (tỷ lệ)
  maxDd?: number;      // max drawdown (tỷ lệ)
  activeBots?: number; // số bot đang chạy
}

export const fundDailyHistory: FundDailySnapshot[] = [
  {
    date: "2025-11-28",
    equity: 10250,
    balance: 10000,
    dailyPnl: 250,
    currentDd: -0.02,
    maxDd: -0.055,
    activeBots: 6,
  },
  {
    date: "2025-11-27",
    equity: 10000,
    balance: 9850,
    dailyPnl: 150,
    currentDd: -0.03,
    maxDd: -0.055,
    activeBots: 6,
  },
  {
    date: "2025-11-26",
    equity: 9850,
    balance: 9800,
    dailyPnl: 50,
    currentDd: -0.035,
    maxDd: -0.055,
    activeBots: 5,
  },
  {
    date: "2025-11-25",
    equity: 9800,
    balance: 9750,
    dailyPnl: 50,
    currentDd: -0.04,
    maxDd: -0.055,
    activeBots: 5,
  },
  {
    date: "2025-11-24",
    equity: 9750,
    balance: 9700,
    dailyPnl: 50,
    currentDd: -0.045,
    maxDd: -0.055,
    activeBots: 4,
  },
  {
    date: "2025-11-23",
    equity: 9700,
    balance: 9680,
    dailyPnl: 20,
    currentDd: -0.05,
    maxDd: -0.055,
    activeBots: 4,
  },
  {
    date: "2025-11-22",
    equity: 9680,
    balance: 9650,
    dailyPnl: 30,
    currentDd: -0.055,
    maxDd: -0.055,
    activeBots: 4,
  },
];

//---------------------------------------------------------
// 2) fundMetricsMock – cho Overview
//---------------------------------------------------------
export const fundMetricsMock = {
  totalEquity: fundDailyHistory[0].equity,
  balance: fundDailyHistory[0].balance,
  openPositions: 3,
  activeBots: fundDailyHistory[0].activeBots ?? 5,
  totalPnl:
    fundDailyHistory[0].equity - fundDailyHistory[fundDailyHistory.length - 1].equity,
  winrate: 0.57,
  maxDrawdown: fundDailyHistory[0].maxDd ?? -0.055,
  profitFactor: 1.85,
  usedMargin: 1200,
  availableMargin: 8500,
  riskMode: "Cross",
  currency: "USDT",
};

//---------------------------------------------------------
// 3) fundEquityHistoryMock – cho chart Overview
//---------------------------------------------------------
export interface EquityHistoryPoint {
  time: string;
  totalEquity: number;
  balance: number;
  totalPnl: number;
}

export const fundEquityHistoryMock: EquityHistoryPoint[] =
  fundDailyHistory
    .slice() // copy
    .reverse() // từ cũ → mới (tùy bạn thích)
    .map((d, _, arr) => {
      const firstEquity = arr[0].equity;
      return {
        time: d.date,
        totalEquity: d.equity,
        balance: d.balance,
        totalPnl: d.equity - firstEquity, // PnL tích lũy so với ngày đầu
      };
    });

//---------------------------------------------------------
// 4) fundPnlHistoryMock – cho tab PnL History
//---------------------------------------------------------
import type { PnlHistoryPoint } from "../../okxClient";

export const fundPnlHistoryMock: PnlHistoryPoint[] = [
  { time: "2025-11-28 14:20", pnl: +120, cumulative: 120 },
  { time: "2025-11-28 13:50", pnl: -40, cumulative: 80 },
  { time: "2025-11-28 13:10", pnl: +85, cumulative: 165 },
  { time: "2025-11-27 22:40", pnl: +150, cumulative: 315 },
  { time: "2025-11-27 18:10", pnl: -55, cumulative: 260 },
  { time: "2025-11-27 15:00", pnl: +60, cumulative: 320 },
  { time: "2025-11-27 10:25", pnl: +30, cumulative: 350 },
  { time: "2025-11-26 19:12", pnl: +40, cumulative: 390 },
  { time: "2025-11-26 17:20", pnl: -25, cumulative: 365 },
  { time: "2025-11-26 14:40", pnl: +35, cumulative: 400 },
];

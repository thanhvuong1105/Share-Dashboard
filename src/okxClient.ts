// src/okxClient.ts
// Frontend client for backend proxy.

import { getApiBase } from "./api/baseUrl";

export type PnlHistoryPoint = {
  ts?: number;
  time: string;
  pnl: number;
  cumulative?: number;
};

export type SignalBotTrade = {
  ts: number;
  time: string;
  pnl: number;
  cumulative: number;
  side?: string;
  instId?: string;
  size?: number;
  price?: number;
};

export type FundOverviewApiPayload = {
  totalEquity: number;
  balance: number;
  totalPnl: number;
  currency?: string;
  raw: any;
};

export type PortfolioPnlHistoryParams = {
  range?: string;
};

const API_BASE = getApiBase();
const NGROK_HEADERS = API_BASE.includes("ngrok")
  ? { "ngrok-skip-browser-warning": "true" }
  : undefined;

export async function fetchFundOverview(): Promise<FundOverviewApiPayload> {
  const res = await fetch(`${API_BASE}/api/fund-overview`, {
    headers: NGROK_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch /api/fund-overview: ${res.status}`);
  }

  const json = await res.json();

  return {
    totalEquity: Number(json.totalEquity || 0),
    balance: Number(json.balance || 0),
    totalPnl: Number(json.totalPnl || 0),
    currency: json.currency || "USDT",
    raw: json.raw,
  };
}

export type TickerInfo = {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  changeAbsolute?: number;
  high24h?: number;
  low24h?: number;
};

export type SingleTicker = {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  changeAbsolute?: number;
  high24h?: number;
  low24h?: number;
  ts?: number;
};

export async function fetchLatestTicker(
  symbols: string[]
): Promise<Record<string, TickerInfo>> {
  if (!symbols.length) return {};
  const params = new URLSearchParams();
  params.set("symbols", symbols.join(","));
  const res = await fetch(`${API_BASE}/api/tickers?${params.toString()}`, {
    headers: NGROK_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch tickers: ${res.status}`);
  }
  const json = await res.json().catch(() => ({}));
  const data = Array.isArray(json.data) ? json.data : [];
  const out: Record<string, TickerInfo> = {};
  data.forEach((item: any) => {
    const symbol = String(item.symbol || item.instId || item.inst || "").toUpperCase();
    if (!symbol) return;
    const lastPrice = Number(item.last || item.lastPrice || item.price || 0);
    const changePercent = Number(item.changePercent || item.chg || item.percentage || 0);
    const changeAbsolute = Number(item.changeAbsolute || item.changeAbs || item.change || 0);
    const high24h = Number(item.high24h || 0);
    const low24h = Number(item.low24h || 0);
    out[symbol] = {
      symbol,
      lastPrice,
      changePercent,
      changeAbsolute,
      high24h,
      low24h,
    };
  });
  return out;
}

export async function fetchMarketTicker(instId: string): Promise<SingleTicker | null> {
  if (!instId) return null;
  const res = await fetch(
    `${API_BASE}/api/market-ticker?instId=${encodeURIComponent(instId)}`
  );
  if (!res.ok) {
    console.warn("fetchMarketTicker failed", res.status);
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!json) return null;

  const last = Number(json.last || 0);
  const changePercent = Number(json.changePercent || 0);
  const changeAbsolute = Number(json.changeAbsolute || 0);
  const high24h = Number(json.high24h || 0);
  const low24h = Number(json.low24h || 0);
  const symbol = String(json.symbol || json.instId || instId || "").toUpperCase();

  return {
    symbol,
    lastPrice: last,
    changePercent,
    changeAbsolute,
    high24h,
    low24h,
    ts: typeof json.ts === "number" ? json.ts : undefined,
  };
}

// ==== PnL History (OKX trade fills) ====

export async function fetchPnlHistory(
  range?: string,
  source: "fills" | "signal" = "signal",
  instType = "SWAP",
  algoOrdType = "contract",
  state = "running,live"
): Promise<PnlHistoryPoint[]> {
  const params = new URLSearchParams();
  if (range && range.length > 0) params.set("range", range);
  if (source) params.set("source", source);
  if (instType) params.set("instType", instType);
  if (source === "signal" && algoOrdType) params.set("algoOrdType", algoOrdType);
  if (source === "signal" && state) params.set("state", state);
  const url = `${API_BASE}/api/pnl-history?${params.toString()}`;

  const res = await fetch(url, { headers: NGROK_HEADERS });

  if (!res.ok) {
    throw new Error(`Failed to fetch /api/pnl-history: ${res.status}`);
  }

  const json = await res.json();

  const rows = Array.isArray(json.trades)
    ? json.trades
    : Array.isArray(json.data)
    ? json.data
    : [];

  let cumulative = 0;
  return rows.map((p: any) => {
    const pnl = Number(p.pnl || p.fillPnl || 0);
    cumulative = Number(p.cumulative ?? cumulative + pnl);
    const ts =
      typeof p.ts === "number"
        ? p.ts
        : p.time
        ? Number(p.time)
        : p.fillTime
        ? Number(p.fillTime)
        : 0;

    const timeStr =
      p.time ||
      (ts
        ? new Date(ts).toISOString().replace("T", " ").slice(0, 19)
        : "");

    return {
      time: String(timeStr),
      pnl,
      cumulative,
    };
  });
}

// Portfolio PnL history helper (defaults 90D, signal source)
export async function fetchPortfolioPnlHistory(
  params: PortfolioPnlHistoryParams = {}
): Promise<PnlHistoryPoint[]> {
  const { range = "90D" } = params;
  return fetchPnlHistory(range, "signal", "SWAP", "contract", "running,live");
}

// ==== Signal Bot PnL History ====
export async function fetchSignalBotHistory(
  algoId: string
): Promise<{ trades: SignalBotTrade[]; summary?: any }> {
  // Nếu không có algoId thì trả rỗng, không throw
  if (!algoId) {
    console.warn("fetchSignalBotHistory: missing algoId");
    return { trades: [], summary: undefined };
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/signal-bot-history?algoId=${encodeURIComponent(algoId)}`,
      { headers: NGROK_HEADERS }
    );

    // cố gắng parse JSON, nếu fail thì dùng object rỗng
    let json: any = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }

    if (!res.ok) {
      console.error(
        "❌ fetchSignalBotHistory HTTP error:",
        res.status,
        json
      );
      // không throw nữa, để UI chỉ hiển thị "No PnL history..." nếu cần
      return { trades: [], summary: json.summary };
    }

    const rawTrades = Array.isArray(json.trades) ? json.trades : [];
    const trades: SignalBotTrade[] = rawTrades.map((t: any) => ({
      ts: Number(t.ts || 0),
      time: String(t.time || ""),
      pnl: Number(t.pnl || 0),
      cumulative: Number(t.cumulative || 0),
      side: t.side,
      instId: t.instId,
      size: Number(t.size || 0),
      price: Number(t.price || 0),
    }));

    return { trades, summary: json.summary };
  } catch (err) {
    console.error("❌ fetchSignalBotHistory exception:", err);
    // fallback an toàn: không cho UI crash, chỉ trả rỗng
    return { trades: [], summary: undefined };
  }
}

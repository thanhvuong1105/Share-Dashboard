// server.cjs - Backend proxy for OKX Sub-Account API (Fund + PnL live, Signal Bots real)

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// =========================
//  LOAD OKX KEYS
// =========================
let OKX_API_KEY = process.env.OKX_API_KEY;
let OKX_SECRET_KEY = process.env.OKX_SECRET_KEY;
let OKX_PASSPHRASE = process.env.OKX_PASSPHRASE;
// Multi-credential support: comma-separated lists
const MULTI_KEYS = (process.env.OKX_API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MULTI_SECRETS = (process.env.OKX_SECRET_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MULTI_PASSPHRASES = (process.env.OKX_PASSPHRASES || "").split(",").map((s) => s.trim()).filter(Boolean);
const MULTI_CREDS =
  MULTI_KEYS.length && MULTI_KEYS.length === MULTI_SECRETS.length && MULTI_KEYS.length === MULTI_PASSPHRASES.length
    ? MULTI_KEYS.map((k, i) => ({
        key: k,
        secret: MULTI_SECRETS[i],
        pass: MULTI_PASSPHRASES[i],
      }))
    : [];

// Nếu thiếu bộ đơn thì dùng bộ đầu tiên trong MULTI làm fallback
if ((!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) && MULTI_CREDS.length) {
  OKX_API_KEY = OKX_API_KEY || MULTI_CREDS[0].key;
  OKX_SECRET_KEY = OKX_SECRET_KEY || MULTI_CREDS[0].secret;
  OKX_PASSPHRASE = OKX_PASSPHRASE || MULTI_CREDS[0].pass;
}
// Cho phép đổi host nếu cần (ví dụ aws.okx.com)
const OKX_BASE_URL =
  (process.env.OKX_BASE_URL || "https://www.okx.com").replace(/\/$/, "");
const OKX_SIMULATED = process.env.OKX_SIMULATED === "1";
const EXTRA_ALGO_IDS = (process.env.OKX_ALGO_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// cache tạm thời danh sách bot active để tránh rỗng khi gọi lỗi
let lastActiveBots = [];
// cache tạm kết quả pnl-history theo range/mode để trả ra nếu fetch lỗi
const pnlHistoryCache = new Map(); // key: `portfolio|${range}` => {trades, summary, ts}
// cache positions-history per bot để dùng khi rate limit
const posHistoryCache = new Map(); // key: algoId => { rows, ts }
// cache trades count per bot
const botTradesCache = new Map(); // key: algoId => { closed, open, total, ts }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Danh sách host fallback để tránh lỗi DNS/region
const OKX_HOSTS = Array.from(
  new Set([OKX_BASE_URL, "https://www.okx.com", "https://aws.okx.com"])
).filter(Boolean);

if ((!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) && !MULTI_CREDS.length) {
  console.log("❌ Missing OKX API credentials in .env");
} else {
  console.log(
    `✅ OKX API credentials loaded (${MULTI_CREDS.length || 1} set${
      MULTI_CREDS.length > 1 ? "s" : ""
    })`
  );
}

// =========================
//  Helper: fetch OKX với fallback host khi DNS lỗi
// =========================
async function fetchOkx(path, options) {
  let lastErr;
  for (const host of OKX_HOSTS) {
    try {
      const url = host + path;
      const resp = await fetch(url, options);
      resp.okxHost = host; // để log nếu cần
      return resp;
    } catch (err) {
      lastErr = err;
      if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") {
        console.warn(`🌐 DNS lỗi với ${host}, thử host khác...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("All OKX hosts failed");
}

// Fetch OKX with multiple credentials and merge data (simple concat)
async function fetchOkxMultiSigned(pathBuilder, processFn) {
  const credsList = MULTI_CREDS.length
    ? MULTI_CREDS
    : [
        {
          key: OKX_API_KEY,
          secret: OKX_SECRET_KEY,
          pass: OKX_PASSPHRASE,
        },
      ];

  const results = [];
  for (let idx = 0; idx < credsList.length; idx++) {
    const creds = credsList[idx];
    if (!creds.key || !creds.secret || !creds.pass) continue;
    const { path, method = "GET", body = "" } = pathBuilder(creds) || {};
    if (!path) continue;
    const ts = new Date().toISOString();
    const sign = signRequestWithCreds(creds, ts, method, path, body);
    const resp = await fetchOkx(path, {
      method,
      headers: {
        "OK-ACCESS-KEY": creds.key,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": creds.pass,
        ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
      },
      body: body || undefined,
    });
    const json = await resp.json();
    results.push({ json, okxHost: resp.okxHost || OKX_BASE_URL, credIdx: idx });
  }

  return processFn(results);
}

// =========================
/** SIGNATURE CREATOR */
// =========================
function signRequest(timestamp, method, path, body = "") {
  const prehash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", OKX_SECRET_KEY).update(prehash).digest("base64");
}

function signRequestWithCreds(creds, timestamp, method, path, body = "") {
  const prehash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", creds.secret).update(prehash).digest("base64");
}

// =========================
// Helper: GET với sign + fallback host (dùng cho signal-bot-history)
// =========================
async function okxSignedGetWithHosts(basePath, paramsObj = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      search.set(k, String(v));
    }
  }
  const queryStr = search.toString();
  const path = queryStr ? `${basePath}?${queryStr}` : basePath;

  const method = "GET";
  const ts = new Date().toISOString();
  const sign = signRequest(ts, method, path);

  const resp = await fetchOkx(path, {
    method,
    headers: {
      "OK-ACCESS-KEY": OKX_API_KEY,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
      ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
    },
  });

  const json = await resp.json();
  return { json, okxHost: resp.okxHost || OKX_BASE_URL };
}

// ===================================================================
//  GET FUND OVERVIEW  (used by Overview tab)
// ===================================================================
app.get("/api/fund-overview", async (req, res) => {
  try {
    // Tính Total Equity từ Assets In Bot (BTC + ETH)
    let botsSource = lastActiveBots || [];

    // nếu chưa có cache active bots thì fetch nhanh từ tất cả cred
    if (!botsSource.length) {
      const botsQuery = new URLSearchParams({
        algoOrdType: "contract",
        limit: "50",
      }).toString();
      const botsResults = [];
      await fetchOkxMultiSigned(
        () => {
          const path = `/api/v5/tradingBot/signal/orders-algo-pending?${botsQuery}`;
          return { path, method: "GET" };
        },
        (arr) => botsResults.push(...arr)
      );
      for (const r of botsResults) {
        if (r.json?.code === "0" && Array.isArray(r.json.data)) {
          botsSource.push(
            ...r.json.data.map((b) => ({ ...b, credIdx: r.credIdx }))
          );
        }
      }
    }

    // nếu vẫn không có bot -> trả 0 để tránh số liệu sai
    if (!botsSource.length) {
      return res.json({
        totalEquity: 0,
        balance: 0,
        totalPnl: 0,
        openPositions: 0,
        currency: "USDT",
        raw: { assets: { btc: 0, eth: 0, invested: 0 } },
      });
    }

    const assets = Array.from(botsSource).reduce(
      (acc, b) => {
        const instIds = Array.isArray(b.instIds) ? b.instIds : [];
        const isBTC = instIds.some((id) => String(id).toUpperCase().includes("BTC"));
        const isETH = instIds.some((id) => String(id).toUpperCase().includes("ETH"));
        // Assets in Bot = Invested Amount + Total PnL (nếu có), fallback availBal+frozenBal
        const invest = Number(b.investAmt || b.investedAmt);
        const pnl = Number(b.totalPnl || b.pnl);
        const bal = Number(b.availBal || 0) + Number(b.frozenBal || 0);

        const investOk = Number.isFinite(invest);
        const pnlOk = Number.isFinite(pnl);
        const val =
          (investOk || pnlOk ? (investOk ? invest : 0) + (pnlOk ? pnl : 0) : bal) ||
          0;

        if (isBTC || isETH) {
          acc.invested += investOk ? invest : 0;
        }
        if (isBTC) acc.btc += val;
        if (isETH) acc.eth += val;
        return acc;
      },
      { btc: 0, eth: 0, invested: 0 }
    );

    // Tổng PnL của tất cả bot (BTC + ETH)
    const totalPnlBots = Array.from(botsSource).reduce(
      (sum, b) => sum + Number(b.totalPnl || b.pnl || 0),
      0
    );

    // Đếm bot đang mở vị thế bằng cách gọi positions (theo đúng credIdx)
    let openPositionsCount = 0;
    for (const b of botsSource) {
      const algoId = String(b.algoId || "");
      if (!algoId) continue;
      const cred =
        b.credIdx !== undefined ? MULTI_CREDS[b.credIdx] : undefined;
      try {
        const params = new URLSearchParams({
          algoOrdType: "contract",
          algoId,
        }).toString();
        const path = `/api/v5/tradingBot/signal/positions?${params}`;
        const ts = new Date().toISOString();
        const sign = cred
          ? signRequestWithCreds(cred, ts, "GET", path)
          : signRequest(ts, "GET", path);
        const resp = await fetchOkx(path, {
          method: "GET",
          headers: {
            "OK-ACCESS-KEY": cred ? cred.key : OKX_API_KEY,
            "OK-ACCESS-SIGN": sign,
            "OK-ACCESS-TIMESTAMP": ts,
            "OK-ACCESS-PASSPHRASE": cred ? cred.pass : OKX_PASSPHRASE,
            ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
          },
        });
        const json = await resp.json();
        if (json?.code === "50011") {
          await sleep(100);
          continue;
        }
        if (json?.code === "0" && Array.isArray(json.data)) {
          const hasOpen = json.data.some(
            (p) => Math.abs(Number(p.pos || 0)) > 0
          );
          if (hasOpen) openPositionsCount += 1;
        }
      } catch (err) {
        console.warn(`⚠️ count open positions failed algoId=${algoId}:`, err);
      }
      await sleep(60); // tránh rate limit
    }

    const totalEquity = assets.btc + assets.eth;
    // Balance = tổng Invested Amount (BTC+ETH) + tổng PnL bots
    const balance = assets.invested + totalPnlBots;

    const payload = {
      totalEquity,
      balance,
      totalPnl: totalPnlBots,
      openPositions: openPositionsCount,
      currency: "USDT",
      raw: { assets },
    };

    return res.json(payload);
  } catch (err) {
    console.error("❌ ERROR /api/fund-overview:", err);
    res.status(500).json({ error: "Failed OKX API" });
  }
});

// ===================================================================
//  GET PnL HISTORY (Signal Bot only) – dùng cho Fund PnL + Bot popup
// ===================================================================
//
// Frontend call Fund (portfolio):
//   /api/pnl-history?range=30D&source=signal
//
// Frontend call Bot (popup):
//   /api/pnl-history?range=30D&source=signal&algoId=6238...&algoOrdType=contract
//
// range hiện tại chỉ dùng để map limit (bao nhiêu dòng history / bot)
// ===================================================================
app.get("/api/pnl-history", async (req, res) => {
  try {
    const range = (req.query.range || "30D").toString();
    const source = (req.query.source || "").toString();
    const algoOrdType = (req.query.algoOrdType || "contract").toString();
    const algoIdQuery = (req.query.algoId || "").toString();
    const credIdxQuery =
      req.query.credIdx !== undefined ? Number(req.query.credIdx) : undefined;
    // Luôn dùng positions-history cho portfolio để khớp popup
    const includePositions = true;

    // map range -> limit (số record / bot)
    let limitPerBot = 100;
    if (range === "7D") limitPerBot = 50;
    else if (range === "30D") limitPerBot = 100;
    else if (range === "90D") limitPerBot = 150;
    else if (range === "180D") limitPerBot = 200;
    else if (range === "365D" || range === "ALL") limitPerBot = 300;

    // ============================
    // CASE: PnL từ SIGNAL BOT
    // ============================
    if (source === "signal") {
      const cacheKey = `portfolio|${range}`;
      const cached = pnlHistoryCache.get(cacheKey);

      // helper: lấy history của 1 bot theo algoId
      const fetchHistoryForBot = async (
        algoId,
        botMeta,
        allowFallback = true,
        credIdxOverride
      ) => {
        const preferredOrdType =
          String(botMeta?.algoOrdType || algoOrdType || "contract") ||
          "contract";
        const ordTypeCandidates =
          preferredOrdType.toLowerCase() === "contract"
            ? ["contract", "spot"] // thử thêm spot nếu contract rỗng
            : [preferredOrdType, "contract"];

        const tryFetch = async (ordType) => {
          const query = new URLSearchParams({
            algoOrdType: ordType,
            algoId,
            limit: String(limitPerBot),
          }).toString();

          const method = "GET";
          const path = `/api/v5/tradingBot/signal/orders-algo-history?${query}`;
          const ts = new Date().toISOString();
          const cred =
            credIdxOverride !== undefined
              ? MULTI_CREDS[credIdxOverride]
              : undefined;
          const sign = cred
            ? signRequestWithCreds(cred, ts, method, path)
            : signRequest(ts, method, path);

          const resp = await fetchOkx(path, {
            method,
            headers: {
              "OK-ACCESS-KEY": cred ? cred.key : OKX_API_KEY,
              "OK-ACCESS-SIGN": sign,
              "OK-ACCESS-TIMESTAMP": ts,
              "OK-ACCESS-PASSPHRASE": cred ? cred.pass : OKX_PASSPHRASE,
              ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
            },
          });

          const json = await resp.json();
          console.log(
            `🔥 SIGNAL BOT HISTORY RAW (algoId=${algoId}, algoOrdType=${ordType}, host ${
              resp.okxHost || OKX_BASE_URL
            }):`,
            JSON.stringify(json, null, 2)
          );

          // Nếu sai tham số algoOrdType (51000) thì bỏ qua và thử ordType khác
          if (json.code === "51000") {
            console.warn(
              `⚠️ OKX báo Parameter algoOrdType error (algoId=${algoId}, algoOrdType=${ordType}), thử ordType khác nếu có`
            );
            return { rows: [], ordTypeUsed: ordType, skipError: true };
          }

          if (json.code !== "0") {
            throw new Error(json.msg || "OKX signal history error");
          }

          const rows = Array.isArray(json.data) ? json.data : [];
          return { rows, ordTypeUsed: ordType, skipError: false };
        };

        // thử lần lượt các ordType ứng viên, lấy cái có dữ liệu đầu tiên
        let rows = [];
        let ordTypeUsed = preferredOrdType;
        for (const ordType of ordTypeCandidates) {
          const res = await tryFetch(ordType);
          rows = res.rows;
          ordTypeUsed = res.ordTypeUsed;
          if (rows.length > 0) break;
        }

        if (rows.length === 0) {
          console.warn(
            `⚠️ Signal history rỗng cho algoId=${algoId}, thử qua ordTypes=${ordTypeCandidates.join(
              ","
            )}`
          );
        }

        // Nếu vẫn rỗng: fallback sang fills-history theo instId đầu tiên (để có dữ liệu gần đúng)
        if (rows.length === 0 && allowFallback) {
          const instIdFallback = Array.isArray(botMeta?.instIds)
            ? botMeta.instIds[0]
            : botMeta?.instId || "";
          const instTypeFallback = (botMeta?.instType || "SWAP").toString();
          if (instIdFallback) {
            try {
              const fillsQuery = new URLSearchParams({
                instId: instIdFallback,
                instType: instTypeFallback,
                limit: String(limitPerBot),
              }).toString();
              const fillsPath = `/api/v5/trade/fills-history?${fillsQuery}`;
              const fillsMethod = "GET";
              const ts = new Date().toISOString();
              const sign = signRequest(ts, fillsMethod, fillsPath);

              const fillsResp = await fetchOkx(fillsPath, {
                method: fillsMethod,
                headers: {
                  "OK-ACCESS-KEY": OKX_API_KEY,
                  "OK-ACCESS-SIGN": sign,
                  "OK-ACCESS-TIMESTAMP": ts,
                  "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
                  ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
                },
              });

              const fillsJson = await fillsResp.json();
              console.log(
                `🔥 FILLS FALLBACK (algoId=${algoId}, instId=${instIdFallback}):`,
                JSON.stringify(fillsJson, null, 2)
              );

              if (fillsJson.code === "0" && Array.isArray(fillsJson.data)) {
                rows.push(
                  ...fillsJson.data.map((row) => ({
                    raw: row,
                    ts: Number(row.fillTime || row.ts || row.cTime || 0),
                    pnl: Number(row.pnl || row.fillPnl || 0),
                    instId: String(row.instId || instIdFallback),
                    algoId,
                    botName:
                      botMeta?.signalChanName ||
                      botMeta?.name ||
                      row.signalChanName ||
                      "",
                    algoOrdType: ordTypeUsed,
                    fallback: "fills-history",
                  }))
                );
              }
            } catch (err) {
              console.warn(
                `⚠️ Fallback fills-history lỗi cho algoId=${algoId}:`,
                err
              );
            }
          }
        }

        return rows.map((row) => {
          const isFallback = row.fallback === "fills-history";
          const openTs = Number(
            row.openTs ||
              row.cTime ||
              row.raw?.cTime ||
              row.raw?.openTime ||
              row.raw?.fillTime ||
              row.raw?.ts ||
              0
          );
          const closeTs = Number(
            row.closeTs ||
              row.uTime ||
              row.ts ||
              row.raw?.fillTime ||
              row.raw?.ts ||
              openTs
          );
          const tsNum = closeTs || openTs;
          const pnl = Number(
            row.pnl ||
              row.totalPnl ||
              row.realizedPnl ||
              row.raw?.pnl ||
              row.raw?.fillPnl ||
              0
          );
          const instId = row.instId
            ? String(row.instId)
            : Array.isArray(row.instIds)
            ? row.instIds[0]
            : String(row.raw?.instId || "");

          // size/price/side từ fills-history hoặc positions-history nếu có
          const size = Number(
            row.size ||
              row.raw?.pos ||
              row.raw?.investAmt ||
              row.raw?.sz ||
              row.raw?.fillSz ||
              0
          );
          const entryPx = Number(
            row.entryPrice ||
              row.entryPx ||
              row.openAvgPx ||
              row.raw?.avgPx ||
              row.raw?.fillPx ||
              row.raw?.px ||
              0
          );
          const exitPx = Number(
            row.exitPrice ||
              row.exitPx ||
              row.closeAvgPx ||
              row.raw?.closeAvgPx ||
              row.raw?.avgPx ||
              row.raw?.fillPx ||
              row.raw?.px ||
              0
          );
          const price = exitPx || entryPx || 0;
          const side = String(
            row.side ||
              row.raw?.side ||
              row.raw?.posSide ||
              row.raw?.fillSide ||
              row.direction ||
              ""
          );

          return {
            raw: row.raw || row,
            ts: tsNum,
            openTs,
            closeTs,
            pnl,
            instId,
            algoId,
            botName:
              botMeta?.signalChanName ||
              row.signalChanName ||
              botMeta?.name ||
              "",
            algoOrdType: ordTypeUsed,
            size,
            price,
            entryPrice: entryPx || undefined,
            exitPrice: exitPx || undefined,
            side,
            fallback: isFallback ? "fills-history" : undefined,
          };
        });
      };

      // helper: lấy positions history (closed) của bot để bổ sung PnL
      const fetchPositionsHistoryForBot = async (algoId, botMeta) => {
        const preferredOrdType =
          String(botMeta?.algoOrdType || algoOrdType || "contract") ||
          "contract";
        const ordType = preferredOrdType || "contract";

        const doFetch = async () => {
          const query = new URLSearchParams({
            algoOrdType: ordType,
            algoId,
            limit: String(limitPerBot),
          }).toString();
          const method = "GET";
          const path = `/api/v5/tradingBot/signal/positions-history?${query}`;
          const ts = new Date().toISOString();
          const cred =
            botMeta?.credIdx !== undefined
              ? MULTI_CREDS[botMeta.credIdx]
              : credIdxQuery !== undefined
              ? MULTI_CREDS[credIdxQuery]
              : undefined;
          const sign = cred
            ? signRequestWithCreds(cred, ts, method, path)
            : signRequest(ts, method, path);

          const resp = await fetchOkx(path, {
            method,
            headers: {
              "OK-ACCESS-KEY": cred ? cred.key : OKX_API_KEY,
              "OK-ACCESS-SIGN": sign,
              "OK-ACCESS-TIMESTAMP": ts,
              "OK-ACCESS-PASSPHRASE": cred ? cred.pass : OKX_PASSPHRASE,
              ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
            },
          });

          const json = await resp.json();
          console.log(
            `🔥 SIGNAL POS HISTORY RAW (algoId=${algoId}, host ${
              resp.okxHost || OKX_BASE_URL
            }):`,
            JSON.stringify(json, null, 2)
          );
          return json;
        };

        // retry nhẹ khi bị 50011 (Too Many Requests) hoặc lỗi không code=0
        let attempts = 0;
        let json;
        while (attempts < 5) {
          attempts++;
          json = await doFetch();
          if (json && json.code === "0" && Array.isArray(json.data)) break;
          if (json?.code === "50011") {
            await sleep(300 + attempts * 100);
            continue;
          }
          await sleep(200);
        }

        if (!json || json.code !== "0" || !Array.isArray(json.data)) {
          const cached = posHistoryCache.get(algoId);
          if (cached) {
            console.warn(
              `⚠️ positions-history failed for algoId=${algoId}, code=${json?.code}, using cached`
            );
            return cached.rows;
          }
          console.warn(
            `⚠️ positions-history failed for algoId=${algoId}, code=${json?.code}`
          );
          return [];
        }

        const mapped = json.data.map((row) => {
          const tsNum = Number(row.uTime || row.cTime || 0);
          const pnl = Number(row.pnl || 0);
          const openTs = Number(row.cTime || row.openTime || 0);
          const closeTs = Number(row.uTime || row.closeTime || tsNum);
          const entryPx = Number(row.openAvgPx || row.avgPx || 0);
          const exitPx = Number(row.closeAvgPx || 0);
          const sizeVal = Math.abs(Number(row.pos || row.sz || 0));
          return {
            raw: row,
            ts: tsNum,
            openTs,
            closeTs,
            pnl,
            instId: String(row.instId || ""),
            algoId,
            botName:
              botMeta?.signalChanName ||
              row.signalChanName ||
              botMeta?.name ||
              "",
            side: String(row.direction || row.posSide || ""),
            price: exitPx || entryPx || 0,
            entryPrice: entryPx || undefined,
            exitPrice: exitPx || undefined,
            size: sizeVal,
            from: "positions-history",
          };
        });

        posHistoryCache.set(algoId, { rows: mapped, ts: Date.now() });
        return mapped;
      };

      let allRows = [];

      // Nếu có cache và không cần refetch (khi thiếu bot), dùng cache để ổn định
      if (!algoIdQuery && cached && lastActiveBots.length === 0) {
        console.warn("⚠️ Using cached pnl-history (no active bots fetched)");
        return res.json({
          range,
          summary: cached.summary,
          trades: cached.trades,
          cached: true,
        });
      }

      if (algoIdQuery) {
        // ------ History của 1 bot cụ thể (popup / mode="bot") ------
        // Lấy metadata bot trước để có instIds/instType cho fallback
        let botMeta = null;
        try {
          const metaParams = new URLSearchParams({
            algoOrdType,
            limit: "50",
          }).toString();
          const metaPath = `/api/v5/tradingBot/signal/orders-algo-pending?${metaParams}`;
          const metaMethod = "GET";
          const tsMeta = new Date().toISOString();
          const cred =
            credIdxQuery !== undefined ? MULTI_CREDS[credIdxQuery] : undefined;
          const signMeta = cred
            ? signRequestWithCreds(cred, tsMeta, metaMethod, metaPath)
            : signRequest(tsMeta, metaMethod, metaPath);

          const metaResp = await fetchOkx(metaPath, {
            method: metaMethod,
            headers: {
              "OK-ACCESS-KEY": cred ? cred.key : OKX_API_KEY,
              "OK-ACCESS-SIGN": signMeta,
              "OK-ACCESS-TIMESTAMP": tsMeta,
              "OK-ACCESS-PASSPHRASE": cred ? cred.pass : OKX_PASSPHRASE,
              ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
            },
          });

          const metaJson = await metaResp.json();
          if (metaJson.code === "0" && Array.isArray(metaJson.data)) {
            botMeta =
              metaJson.data.find(
                (b) => String(b.algoId || "") === String(algoIdQuery)
              ) || null;
          }
        } catch (err) {
          console.warn("⚠️ Không lấy được meta bot để fallback:", err);
        }

        // Bot view: tắt fallback để không lẫn fills chung của futures vào bot
        allRows = await fetchHistoryForBot(
          algoIdQuery,
          botMeta,
          false,
          credIdxQuery
        );
      } else {
        // ------ Portfolio: gom toàn bộ active signal bot ------
        // lấy pending từ tất cả cred
        const botsQuery = new URLSearchParams({
          algoOrdType,
          limit: "50", // số lượng bot tối đa gom
        }).toString();

        const botsResults = [];
        await fetchOkxMultiSigned(
          () => {
            const path = `/api/v5/tradingBot/signal/orders-algo-pending?${botsQuery}`;
            return { path, method: "GET" };
          },
          (arr) => botsResults.push(...arr)
        );

        // merge dữ liệu và gắn credIdx
        const mergedBots = [];
        for (const r of botsResults) {
          if (r.json?.code === "0" && Array.isArray(r.json.data)) {
            mergedBots.push(
              ...r.json.data.map((b) => ({ ...b, credIdx: r.credIdx }))
            );
          }
        }

        if (mergedBots.length === 0) {
          if (lastActiveBots.length === 0) {
            return res.status(500).json({
              error: "Failed to load active signal bots",
              raw: botsResults.map((r) => r.json),
            });
          }
          console.warn("⚠️ active bots fetch failed, using cached bots");
        } else {
          lastActiveBots = mergedBots;
        }

        const bots = lastActiveBots.length ? lastActiveBots : mergedBots;
        // Bổ sung thêm algoId thủ công từ env nếu cần
        const extraBots = EXTRA_ALGO_IDS.filter(
          (id) => !bots.find((b) => String(b.algoId || "") === id)
        ).map((id) => ({ algoId: id }));
        const allBotItems = bots.concat(extraBots);

        if (includePositions) {
          // Chỉ lấy positions-history (đóng lệnh) để khớp popup
          const posRows = [];
          for (const b of allBotItems) {
            const algoId = String(b.algoId || "");
            if (!algoId) continue;
            const rows = await fetchPositionsHistoryForBot(algoId, b);
            posRows.push(...rows);
            // tránh rate limit
            await sleep(120);
          }
          allRows = posRows;
        } else {
          const promises = allBotItems
            .map((b) => ({
              algoId: String(b.algoId || ""),
              meta: b,
            }))
            .filter((x) => x.algoId)
            .map((x) =>
              fetchHistoryForBot(
                x.algoId,
                x.meta,
                true,
                x.meta?.credIdx !== undefined ? x.meta.credIdx : undefined
              )
            );

          const perBot = await Promise.all(promises);
          allRows = perBot.flat();
        }
      }

      // Lọc theo range (dựa trên closeTs hoặc ts), sort, tính cumulative
      const rangeToMs = {
        "7D": 7 * 86400000,
        "30D": 30 * 86400000,
        "90D": 90 * 86400000,
        "180D": 180 * 86400000,
        "365D": 365 * 86400000,
        ALL: Number.POSITIVE_INFINITY,
      };
      const windowMs = rangeToMs[range] ?? rangeToMs["30D"];
      const now = Date.now();

      const filtered = allRows
        .filter((r) => r.ts && !Number.isNaN(r.ts))
        .filter((r) => {
          if (windowMs === Number.POSITIVE_INFINITY) return true;
          const ts = Number(r.closeTs || r.ts || 0);
          return now - ts <= windowMs;
        })
        .sort((a, b) => (a.closeTs || a.ts) - (b.closeTs || b.ts));

      let cumulative = 0;
      const trades = filtered.map((row) => {
        cumulative += row.pnl;
        const raw = row.raw || {};

        const sizeVal = Math.abs(
          Number(row.size || 0) ||
            Number(raw.pos || raw.sz || raw.fillSz || 0) ||
            Number(row.investAmt || raw.investAmt || 0)
        );
        const entryPx =
          row.entryPrice ||
          row.openAvgPx ||
          raw.openAvgPx ||
          raw.avgPx ||
          raw.fillPx ||
          0;
        const exitPx =
          row.exitPrice ||
          row.closeAvgPx ||
          raw.closeAvgPx ||
          raw.avgPx ||
          raw.fillPx ||
          0;
        const openTs = Number(row.openTs || raw.cTime || row.ts || 0);
        const closeTs = Number(row.closeTs || row.ts || 0);

        return {
          ts: row.ts,
          time: row.ts
            ? new Date(row.ts).toISOString().replace("T", " ").slice(0, 19)
            : "",
          pnl: row.pnl,
          cumulative,
          fee: 0,
          side: String(raw.side || raw.direction || ""),
          instId: row.instId || "",
          size: sizeVal,
          price: exitPx || entryPx || 0,
          entryPrice: entryPx || undefined,
          exitPrice: exitPx || undefined,
          openTs: openTs || undefined,
          closeTs: closeTs || undefined,
          algoId: row.algoId,
          botName: row.botName || "",
        };
      });

      const totalTrades = trades.length;
      const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
      const wins = trades.filter((t) => t.pnl > 0).length;
      const winrate = totalTrades > 0 ? wins / totalTrades : 0;

      // lưu cache
      pnlHistoryCache.set(`portfolio|${range}`, {
        trades,
        summary: { totalTrades, totalPnl, winrate },
        ts: Date.now(),
      });

      return res.json({
        range,
        summary: {
          totalTrades,
          totalPnl,
          winrate,
        },
        trades,
      });
    }

    // ============================
    // CASE KHÁC: fallback về fills-history (nếu cần)
    // ============================
    const instType = (req.query.instType || "SWAP").toString();
    let limit = 100;
    if (range === "7D") limit = 50;
    else if (range === "30D") limit = 100;
    else if (range === "90D") limit = 200;
    else if (range === "180D") limit = 300;
    else if (range === "365D" || range === "ALL") limit = 500;

    const query = new URLSearchParams({
      instType,
      limit: String(limit),
    }).toString();

    const method = "GET";
    const path = `/api/v5/trade/fills-history?${query}`;
    const ts = new Date().toISOString();
    const sign = signRequest(ts, method, path);

    const result = await fetchOkx(path, {
      method,
      headers: {
        "OK-ACCESS-KEY": OKX_API_KEY,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
        ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
      },
    });

    const json = await result.json();
    console.log(
      `🔥 OKX FILLS RAW (fallback, host ${
        result.okxHost || OKX_BASE_URL
      }):`,
      JSON.stringify(json, null, 2)
    );

    if (json.code !== "0") {
      return res
        .status(500)
        .json({ error: json.msg || "OKX error", raw: json });
    }

    const rows = Array.isArray(json.data) ? json.data : [];
    const sorted = rows
      .map((row) => ({
        raw: row,
        ts: Number(row.fillTime || row.ts || row.cTime || 0),
      }))
      .sort((a, b) => a.ts - b.ts);

    let cumulative = 0;
    const trades = sorted.map(({ raw, ts }) => {
      const pnl = Number(raw.pnl || raw.fillPnl || 0);
      cumulative += pnl;

      return {
        ts,
        time: ts
          ? new Date(ts).toISOString().replace("T", " ").slice(0, 19)
          : "",
        pnl,
        cumulative,
        fee: Number(raw.fee || raw.fillFee || 0),
        side: String(raw.side || raw.fillSide || raw.posSide || ""),
        instId: String(raw.instId || ""),
        size: Number(raw.sz || raw.size || 0),
        price: Number(raw.fillPx || raw.avgPx || raw.px || 0),
      };
    });

    const totalTrades = trades.length;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const wins = trades.filter((t) => t.pnl > 0).length;
    const winrate = totalTrades > 0 ? wins / totalTrades : 0;

    return res.json({
      range,
      summary: {
        totalTrades,
        totalPnl,
        winrate,
      },
      trades,
    });
  } catch (err) {
    console.error("❌ ERROR /api/pnl-history:", err);
    res.status(500).json({ error: "Failed OKX API", detail: String(err) });
  }
});

// ===================================================================
//  SIGNAL BOT LIST – proxy OKX
//  GET /api/signal-bots?instType=SWAP&algoOrdType=contract
// ===================================================================
app.get("/api/signal-bots", async (req, res) => {
  try {
    const instType = (req.query.instType || "SWAP").toString();
    const algoOrdType = (req.query.algoOrdType || "contract").toString();
    const limit = (req.query.limit || "100").toString();

    const params = new URLSearchParams({
      instType,
      algoOrdType,
      limit,
    });

    const path = `/api/v5/tradingBot/signal/orders-algo-history?${params.toString()}`;
    const method = "GET";
    const ts = new Date().toISOString();
    const sign = signRequest(ts, method, path);

    const resp = await fetchOkx(path, {
      method,
      headers: {
        "OK-ACCESS-KEY": OKX_API_KEY,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
        ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
      },
    });

    const json = await resp.json();
    console.log(
      `🔥 SIGNAL BOT LIST RAW (host ${resp.okxHost || OKX_BASE_URL}):`,
      JSON.stringify(json, null, 2)
    );

    if (json.code !== "0" || !Array.isArray(json.data)) {
      return res.status(500).json({
        error: json.msg || "Failed to load signal bots",
        raw: json,
      });
    }

    // Lọc bot đang chạy ở phía server
    const activeStates = ["running", "live"];
    const activeBots = json.data.filter((b) =>
      activeStates.includes(String(b.state || "").toLowerCase())
    );

    return res.json({
      code: "0",
      data: activeBots,
      msg: "",
    });
  } catch (err) {
    console.error("❌ ERROR /api/signal-bots:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============== SIGNAL BOT HISTORY (per bot) ===============
app.get("/api/signal-bot-history", async (req, res) => {
  try {
    const algoId = req.query.algoId;
    if (!algoId) {
      return res.status(400).json({ error: "Missing algoId" });
    }

    // lấy metadata bot để biết instIds/instType và algoOrdType
    let botMeta = null;
    try {
      const metaParams = new URLSearchParams({
        algoOrdType: "contract",
        limit: "50",
      }).toString();
      const metaPath = `/api/v5/tradingBot/signal/orders-algo-pending?${metaParams}`;
      const metaMethod = "GET";
      const tsMeta = new Date().toISOString();
      const signMeta = signRequest(tsMeta, metaMethod, metaPath);
      const metaResp = await fetchOkx(metaPath, {
        method: metaMethod,
        headers: {
          "OK-ACCESS-KEY": OKX_API_KEY,
          "OK-ACCESS-SIGN": signMeta,
          "OK-ACCESS-TIMESTAMP": tsMeta,
          "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
          ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
        },
      });
      const metaJson = await metaResp.json();
      if (metaJson.code === "0" && Array.isArray(metaJson.data)) {
        botMeta =
          metaJson.data.find(
            (b) => String(b.algoId || "") === String(algoId)
          ) || null;
      }
    } catch (err) {
      console.warn("⚠️ Không lấy được meta bot (history):", err);
    }

    const limitPerBot = 100;
    const preferredOrdType =
      String(botMeta?.algoOrdType || "contract") || "contract";
    const ordTypeCandidates =
      preferredOrdType.toLowerCase() === "contract"
        ? ["contract", "spot"]
        : [preferredOrdType, "contract"];

    const tryFetch = async (ordType) => {
      const query = new URLSearchParams({
        algoOrdType: ordType,
        algoId: String(algoId),
        limit: String(limitPerBot),
      }).toString();

      const method = "GET";
      const path = `/api/v5/tradingBot/signal/orders-algo-history?${query}`;
      const ts = new Date().toISOString();
      const sign = signRequest(ts, method, path);

      const resp = await fetchOkx(path, {
        method,
        headers: {
          "OK-ACCESS-KEY": OKX_API_KEY,
          "OK-ACCESS-SIGN": sign,
          "OK-ACCESS-TIMESTAMP": ts,
          "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
          ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
        },
      });

      const json = await resp.json();
      console.log(
        `🔥 SIGNAL BOT HISTORY RAW (algoId=${algoId}, algoOrdType=${ordType}, host ${
          resp.okxHost || OKX_BASE_URL
        }):`,
        JSON.stringify(json, null, 2)
      );

      if (json.code === "51000") {
        return { rows: [], ordTypeUsed: ordType, skipError: true };
      }
      if (json.code !== "0") {
        throw new Error(json.msg || "OKX signal history error");
      }
      const rows = Array.isArray(json.data) ? json.data : [];
      return { rows, ordTypeUsed: ordType, skipError: false };
    };

    let rows = [];
    let ordTypeUsed = preferredOrdType;
    for (const ordType of ordTypeCandidates) {
      const resFetch = await tryFetch(ordType);
      rows = resFetch.rows;
      ordTypeUsed = resFetch.ordTypeUsed;
      if (rows.length > 0) break;
    }

    // Không dùng fallback fills ở endpoint này để tránh trộn lệnh futures; nếu OKX rỗng thì trả rỗng

    let cum = 0;
    const trades = rows
      .filter((r) => r && Number(r.ts))
      .sort((a, b) => Number(a.ts) - Number(b.ts))
      .map((row) => {
        const ts = Number(
          row.ts || row.uTime || row.cTime || row.raw?.fillTime || Date.now()
        );
        const pnl = Number(
          row.pnl ||
            row.totalPnl ||
            row.realizedPnl ||
            row.raw?.pnl ||
            row.raw?.fillPnl ||
            0
        );
        const size = Number(
          row.size ||
            row.raw?.investAmt ||
            row.raw?.sz ||
            row.raw?.fillSz ||
            0
        );
        const price = Number(
          row.price || row.raw?.avgPx || row.raw?.fillPx || row.raw?.px || 0
        );
        const side = String(
          row.side ||
            row.raw?.side ||
            row.raw?.posSide ||
            row.raw?.fillSide ||
            ""
        ).toLowerCase();
        const instId = String(
          row.instId ||
            (Array.isArray(row.instIds) ? row.instIds[0] : "") ||
            row.raw?.instId ||
            ""
        );

        cum += pnl;
        return {
          ts,
          time: new Date(ts).toISOString(),
          pnl,
          cumulative: cum,
          side,
          instId,
          size,
          price,
          algoId: String(algoId),
        };
      });

    return res.status(200).json({
      algoId: String(algoId),
      trades,
    });
  } catch (err) {
    console.error("❌ /api/signal-bot-history error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Failed to fetch signal bot history" });
  }
});

// ===================================================================
//  ACTIVE SIGNAL BOTS (orders-algo-pending)
//  GET /api/signal-active-bots?algoOrdType=contract&limit=100
// ===================================================================
app.get("/api/signal-active-bots", async (req, res) => {
  try {
    const algoOrdType = (req.query.algoOrdType || "contract").toString();
    const after = (req.query.after || "").toString();
    const before = (req.query.before || "").toString();
    const limit = (req.query.limit || "100").toString();

    const processResults = (arr) => {
      let merged = [];
      let errs = [];
      for (const r of arr) {
        if (r.json?.code === "0" && Array.isArray(r.json.data)) {
          // gắn credIdx để frontend biết bot thuộc account nào
          merged = merged.concat(
            r.json.data.map((d) => ({ ...d, credIdx: r.credIdx }))
          );
        } else {
          errs.push(r.json?.msg || r.json?.error || "Error");
        }
      }
      if (!merged.length) {
        return res.status(500).json({
          error: errs.join("; ") || "Failed to load active signal bots",
          raw: arr.map((r) => r.json),
        });
      }
      return res.json({ code: "0", data: merged, errs });
    };

    await fetchOkxMultiSigned(
      () => {
        const params = new URLSearchParams({ algoOrdType, limit });
        if (after) params.set("after", after);
        if (before) params.set("before", before);
        const path = `/api/v5/tradingBot/signal/orders-algo-pending?${params.toString()}`;
        return { path, method: "GET" };
      },
      processResults
    );
  } catch (err) {
    console.error("❌ ERROR /api/signal-active-bots:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  PUBLIC TICKER (last price) – dùng cho Bot Details
//  GET /api/market-ticker?instId=BTC-USDT-SWAP
// ===================================================================
app.get("/api/market-ticker", async (req, res) => {
  try {
    const instId = (req.query.instId || "").toString();
    if (!instId) {
      return res.status(400).json({ error: "Missing instId" });
    }

    const query = new URLSearchParams({ instId });
    const path = `/api/v5/market/ticker?${query.toString()}`;
    const resp = await fetchOkx(path, { method: "GET" });
    const json = await resp.json();

    console.log(
      `🔥 MARKET TICKER RAW (instId=${instId}, host ${resp.okxHost || OKX_BASE_URL}):`,
      JSON.stringify(json, null, 2)
    );

    if (json.code !== "0" || !Array.isArray(json.data) || !json.data[0]) {
      return res
        .status(500)
        .json({ error: json.msg || "Failed to load ticker", raw: json });
    }

    const t = json.data[0];
    return res.json({
      instId,
      last: Number(t.last || 0),
      ask: Number(t.askPx || 0),
      bid: Number(t.bidPx || 0),
      high24h: Number(t.high24h || 0),
      low24h: Number(t.low24h || 0),
      ts: Number(t.ts || Date.now()),
      raw: t,
    });
  } catch (err) {
    console.error("❌ ERROR /api/market-ticker:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  LATEST FILL (signed) – dùng để lấy entry price/size gần nhất cho bot
//  GET /api/latest-fill?instId=BTC-USDT-SWAP&instType=SWAP&limit=1
// ===================================================================
app.get("/api/latest-fill", async (req, res) => {
  try {
    const instId = (req.query.instId || "").toString();
    const instType = (req.query.instType || "SWAP").toString();
    const limit = (req.query.limit || "1").toString();

    if (!instId) {
      return res.status(400).json({ error: "Missing instId" });
    }

    const query = new URLSearchParams({
      instId,
      instType,
      limit,
    });

    const path = `/api/v5/trade/fills-history?${query.toString()}`;
    const method = "GET";
    const ts = new Date().toISOString();
    const sign = signRequest(ts, method, path);

    const resp = await fetchOkx(path, {
      method,
      headers: {
        "OK-ACCESS-KEY": OKX_API_KEY,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
        ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
      },
    });

    const json = await resp.json();
    console.log(
      `🔥 LATEST FILL RAW (instId=${instId}, instType=${instType}, host ${resp.okxHost || OKX_BASE_URL}):`,
      JSON.stringify(json, null, 2)
    );

    if (json.code !== "0" || !Array.isArray(json.data)) {
      return res
        .status(500)
        .json({ error: json.msg || "Failed to load fills", raw: json });
    }

    const rows = json.data
      .map((r) => ({
        ts: Number(r.fillTime || r.ts || r.cTime || 0),
        price: Number(r.fillPx || r.avgPx || 0),
        size: Number(r.fillSz || r.sz || 0),
        side: String(r.side || r.posSide || r.fillSide || ""),
        instId: String(r.instId || instId),
        raw: r,
      }))
      .sort((a, b) => Number(b.ts) - Number(a.ts)); // mới nhất trước

    const latest = rows[0] || null;
    return res.json({
      instId,
      instType,
      latest,
    });
  } catch (err) {
    console.error("❌ ERROR /api/latest-fill:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  POSITIONS (signed) – lấy vị thế hiện tại theo instId
//  GET /api/positions?instId=BTC-USDT-SWAP
// ===================================================================
app.get("/api/positions", async (req, res) => {
  try {
    const instId = (req.query.instId || "").toString();
    if (!instId) {
      return res.status(400).json({ error: "Missing instId" });
    }

    const query = new URLSearchParams({ instId });
    const path = `/api/v5/account/positions?${query.toString()}`;
    const method = "GET";
    const ts = new Date().toISOString();
    const sign = signRequest(ts, method, path);

    const resp = await fetchOkx(path, {
      method,
      headers: {
        "OK-ACCESS-KEY": OKX_API_KEY,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
        ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
      },
    });

    const json = await resp.json();
    console.log(
      `🔥 POSITIONS RAW (instId=${instId}, host ${resp.okxHost || OKX_BASE_URL}):`,
      JSON.stringify(json, null, 2)
    );

    if (json.code !== "0" || !Array.isArray(json.data)) {
      return res
        .status(500)
        .json({ error: json.msg || "Failed to load positions", raw: json });
    }

    // chuẩn hóa: lấy vị thế theo instId (OKX trả 1 hoặc nhiều, ví dụ long/short)
    const positions = json.data
      .filter((p) => String(p.instId || "") === instId)
      .map((p) => ({
        instId: String(p.instId || instId),
        pos: Number(p.pos || 0),
        posSide: String(p.posSide || ""),
        avgPx: Number(p.avgPx || 0),
        last: Number(p.last || p.markPx || p.lastPx || 0),
        markPx: Number(p.markPx || 0),
        pnl: Number(p.upl || 0),
        liqPx: Number(p.liqPx || 0),
        lever: Number(p.lever || 0),
        mgnMode: String(p.mgnMode || ""),
        cTime: Number(p.cTime || 0),
        uTime: Number(p.uTime || 0),
        raw: p,
      }));

    return res.json({ instId, positions });
  } catch (err) {
    console.error("❌ ERROR /api/positions:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  SIGNAL BOT POSITIONS (per algoId) – lấy entry/pos/mark theo bot
//  GET /api/signal-positions?algoId=...&algoOrdType=contract
// ===================================================================
app.get("/api/signal-positions", async (req, res) => {
  try {
    const algoId = (req.query.algoId || "").toString();
    const algoOrdType = (req.query.algoOrdType || "contract").toString();
    const credIdxParam = req.query.credIdx;
    if (!algoId) {
      return res.status(400).json({ error: "Missing algoId" });
    }

    const processResults = (arr) => {
      let merged = [];
      let errs = [];
      for (const r of arr) {
        if (r.json?.code === "0" && Array.isArray(r.json.data)) {
          merged = merged.concat(r.json.data);
        } else {
          errs.push(r.json?.msg || r.json?.error || "Error");
        }
      }
      if (!merged.length) {
        return res.status(500).json({
          error: errs.join("; ") || "Failed to load signal positions",
          raw: arr.map((r) => r.json),
        });
      }
      const positions = merged.map((p) => ({
        algoId: String(p.algoId || algoId),
        instId: String(p.instId || ""),
        instType: String(p.instType || ""),
        pos: Number(p.pos || 0),
        posSide: String(p.posSide || p.direction || ""),
        avgPx: Number(p.avgPx || p.openAvgPx || 0),
        last: Number(p.last || p.markPx || 0),
        markPx: Number(p.markPx || 0),
        pnl: Number(p.upl || p.pnl || 0),
        liqPx: Number(p.liqPx || 0),
        lever: Number(p.lever || 0),
        ccy: String(p.ccy || ""),
        mgnMode: String(p.mgnMode || p.mgnMode || ""),
        cTime: Number(p.cTime || 0),
        uTime: Number(p.uTime || 0),
        raw: p,
      }));
      return res.json({ algoId, positions, errs });
    };

    if (credIdxParam !== undefined && MULTI_CREDS.length) {
      const idx = Number(credIdxParam);
      const creds = MULTI_CREDS[idx];
      if (!creds) throw new Error("Invalid credIdx");
      const query = new URLSearchParams({ algoOrdType, algoId });
      const path = `/api/v5/tradingBot/signal/positions?${query.toString()}`;
      const ts = new Date().toISOString();
      const sign = signRequestWithCreds(creds, ts, "GET", path);
      const resp = await fetchOkx(path, {
        method: "GET",
        headers: {
          "OK-ACCESS-KEY": creds.key,
          "OK-ACCESS-SIGN": sign,
          "OK-ACCESS-TIMESTAMP": ts,
          "OK-ACCESS-PASSPHRASE": creds.pass,
          ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
        },
      });
      const json = await resp.json();
      return processResults([{ json, okxHost: resp.okxHost || OKX_BASE_URL, credIdx: idx }]);
    } else {
      await fetchOkxMultiSigned(
        () => {
          const query = new URLSearchParams({
            algoOrdType,
            algoId,
          });
          const path = `/api/v5/tradingBot/signal/positions?${query.toString()}`;
          return { path, method: "GET" };
        },
        processResults
      );
    }
  } catch (err) {
    console.error("❌ ERROR /api/signal-positions:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  SIGNAL BOT POSITIONS HISTORY (closed) – lấy lịch sử vị thế đã đóng
//  GET /api/signal-positions-history?algoId=...&algoOrdType=contract
// ===================================================================
app.get("/api/signal-positions-history", async (req, res) => {
  try {
    const algoId = (req.query.algoId || "").toString();
    const algoOrdType = (req.query.algoOrdType || "contract").toString();
    const limit = (req.query.limit || "100").toString();
    const after = (req.query.after || "").toString();
    const before = (req.query.before || "").toString();
    const credIdxParam = req.query.credIdx;

    if (!algoId) {
      return res.status(400).json({ error: "Missing algoId" });
    }

    const processResults = (arr) => {
      let merged = [];
      let errs = [];
      let codes = [];
      for (const r of arr) {
        if (r.json?.code === "0" && Array.isArray(r.json.data)) {
          merged = merged.concat(r.json.data);
        } else {
          const msg = r.json?.msg || r.json?.error || "Error";
          errs.push(msg);
          if (r.json?.code) codes.push(String(r.json.code));
        }
      }
      if (!merged.length) {
        const safeCodes = new Set(["50011", "51291", "50034"]);
        const allSafe = codes.length > 0 && codes.every((c) => safeCodes.has(String(c)));
        const cache = posHistoryCache.get(algoId);
        if (cache && Date.now() - cache.ts < 5 * 60 * 1000) {
          return res.json({ algoId, data: cache.rows, cached: true, errs });
        }
        if (allSafe) {
          return res.json({ algoId, data: [], errs });
        }
        // fallback: trả empty + errs để tránh HTTP 500 nhưng vẫn log lỗi
        return res.json({
          algoId,
          data: [],
          errs,
          raw: arr.map((r) => r.json),
        });
      }
      const rows = merged.map((p) => ({
        algoId: String(p.algoId || algoId),
        instId: String(p.instId || ""),
        instType: String(p.instType || ""),
        openAvgPx: Number(p.openAvgPx || 0),
        closeAvgPx: Number(p.closeAvgPx || 0),
        pnl: Number(p.pnl || 0),
        pnlRatio: Number(p.pnlRatio || 0),
        lever: Number(p.lever || 0),
        direction: String(p.direction || p.posSide || ""),
        cTime: Number(p.cTime || 0),
        uTime: Number(p.uTime || 0),
        mgnMode: String(p.mgnMode || ""),
        raw: p,
      }));
      return res.json({ algoId, data: rows, errs });
    };

    if (credIdxParam !== undefined && MULTI_CREDS.length) {
      const idx = Number(credIdxParam);
      const creds = MULTI_CREDS[idx];
      if (!creds) throw new Error("Invalid credIdx");
      const params = new URLSearchParams({
        algoOrdType,
        algoId,
        limit,
      });
      if (after) params.set("after", after);
      if (before) params.set("before", before);
      const path = `/api/v5/tradingBot/signal/positions-history?${params.toString()}`;
      const ts = new Date().toISOString();
      const sign = signRequestWithCreds(creds, ts, "GET", path);
      const resp = await fetchOkx(path, {
        method: "GET",
        headers: {
          "OK-ACCESS-KEY": creds.key,
          "OK-ACCESS-SIGN": sign,
          "OK-ACCESS-TIMESTAMP": ts,
          "OK-ACCESS-PASSPHRASE": creds.pass,
          ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
        },
      });
      const json = await resp.json();
      return processResults([{ json, okxHost: resp.okxHost || OKX_BASE_URL, credIdx: idx }]);
    } else {
      await fetchOkxMultiSigned(
        () => {
          const params = new URLSearchParams({
            algoOrdType,
            algoId,
            limit,
          });
          if (after) params.set("after", after);
          if (before) params.set("before", before);
          const path = `/api/v5/tradingBot/signal/positions-history?${params.toString()}`;
          return { path, method: "GET" };
        },
        processResults
      );
    }
  } catch (err) {
    console.error("❌ ERROR /api/signal-positions-history:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  SIGNAL BOT DETAILS (để lấy vốn/availBal)
//  GET /api/signal-orders-details?algoId=...&algoOrdType=contract
// ===================================================================
app.get("/api/signal-orders-details", async (req, res) => {
  try {
    const algoId = (req.query.algoId || "").toString();
    const algoOrdType = (req.query.algoOrdType || "contract").toString();
    const credIdxParam = req.query.credIdx;
    if (!algoId) {
      return res.status(400).json({ error: "Missing algoId" });
    }

    const handleResp = (arr) => {
      for (const r of arr) {
        if (r.json?.code === "0" && Array.isArray(r.json.data)) {
          return res.json({ code: "0", data: r.json.data, credIdx: r.credIdx });
        }
      }
      const first = arr[0]?.json;
      return res.status(500).json({
        error: "Failed to load orders details",
        raw: arr.map((x) => x.json),
        first,
      });
    };

    if (credIdxParam !== undefined && MULTI_CREDS.length) {
      const idx = Number(credIdxParam);
      const creds = MULTI_CREDS[idx];
      if (!creds) return res.status(400).json({ error: "Invalid credIdx" });
      const params = new URLSearchParams({ algoId, algoOrdType });
      const path = `/api/v5/tradingBot/signal/orders-algo-details?${params.toString()}`;
      const ts = new Date().toISOString();
      const sign = signRequestWithCreds(creds, ts, "GET", path);
      const resp = await fetchOkx(path, {
        method: "GET",
        headers: {
          "OK-ACCESS-KEY": creds.key,
          "OK-ACCESS-SIGN": sign,
          "OK-ACCESS-TIMESTAMP": ts,
          "OK-ACCESS-PASSPHRASE": creds.pass,
          ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
        },
      });
      const json = await resp.json();
      return handleResp([{ json, credIdx: idx }]);
    }

    await fetchOkxMultiSigned(
      () => {
        const params = new URLSearchParams({ algoId, algoOrdType });
        const path = `/api/v5/tradingBot/signal/orders-algo-details?${params.toString()}`;
        return { path, method: "GET" };
      },
      handleResp
    );
  } catch (err) {
    console.error("❌ ERROR /api/signal-orders-details:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================================================================
//  BOT TRADES COUNT (closed positions + open position)
//  GET /api/bot-trades?algoId=...
// ===================================================================
app.get("/api/bot-trades", async (req, res) => {
  try {
    const algoId = (req.query.algoId || "").toString();
    if (!algoId) return res.status(400).json({ error: "Missing algoId" });
    const credIdxParam = req.query.credIdx;

    const cacheKey =
      credIdxParam !== undefined ? `${algoId}::${credIdxParam}` : algoId;
    const cached = botTradesCache.get(cacheKey);
    const STALE_MS = 5 * 60 * 1000;
    if (cached && Date.now() - cached.ts < STALE_MS) {
      return res.json(cached);
    }

    const credsList =
      MULTI_CREDS.length > 0
        ? MULTI_CREDS
        : [
            {
              key: OKX_API_KEY,
              secret: OKX_SECRET_KEY,
              pass: OKX_PASSPHRASE,
            },
          ];

    const fetchClosedWithCreds = async (creds) => {
      if (!creds?.key || !creds?.secret || !creds?.pass) {
        return { ok: false, closed: 0 };
      }
      const PAGE_LIMIT = 100;
      const MAX_PAGES = 20;
      let beforeCursor = "";
      let totalClosed = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          algoOrdType: "contract",
          algoId,
          limit: String(PAGE_LIMIT),
        });
        if (beforeCursor) params.set("before", beforeCursor);
        const path = '/api/v5/tradingBot/signal/positions-history?' + params.toString();
        const ts = new Date().toISOString();
        const sign = signRequestWithCreds(creds, ts, "GET", path);
        const resp = await fetchOkx(path, {
          method: "GET",
          headers: {
            "OK-ACCESS-KEY": creds.key,
            "OK-ACCESS-SIGN": sign,
            "OK-ACCESS-TIMESTAMP": ts,
            "OK-ACCESS-PASSPHRASE": creds.pass,
            ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
          },
        });
        const json = await resp.json();
        if (json?.code !== "0" || !Array.isArray(json.data)) {
          const errCode = json?.code;
          if (errCode === "50011" || errCode === "51291") {
            await sleep(400);
            page -= 1;
            continue;
          }
          return { ok: false, closed: totalClosed, code: errCode };
        }
        const rows = json.data;
        totalClosed += rows.length;
        if (rows.length < PAGE_LIMIT) {
          return { ok: true, closed: totalClosed };
        }
        const last = rows[rows.length - 1] || {};
        const nextBefore =
          last.uTime ||
          last.cTime ||
          last.closeTime ||
          last.ts ||
          last.createdTime ||
          null;
        if (!nextBefore) {
          return { ok: true, closed: totalClosed };
        }
        beforeCursor = String(nextBefore);
        await sleep(120);
      }
      return { ok: true, closed: totalClosed };
    };

    let closed = 0;
    let resolvedCredIdx =
      credIdxParam !== undefined ? Number(credIdxParam) : undefined;
    try {
      if (resolvedCredIdx !== undefined) {
        const idx = resolvedCredIdx;
        const creds = credsList[idx];
        if (!creds) {
          throw new Error(`Invalid credIdx ${idx}`);
        }
        const result = await fetchClosedWithCreds(creds);
        if (result.ok) {
          closed = result.closed;
        }
      } else {
        for (let idx = 0; idx < credsList.length; idx++) {
          const creds = credsList[idx];
          if (!creds?.key) continue;
          const result = await fetchClosedWithCreds(creds);
          if (result.ok) {
            closed = result.closed;
            resolvedCredIdx = idx;
            if (closed > 0) break;
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ bot-trades positions-history error:", err);
    }

    let open = 0;
    try {
      const fetchOpenWithCreds = async (creds) => {
        if (!creds?.key) return false;
        const params = new URLSearchParams({ algoId, algoOrdType: "contract" });
        const path = '/api/v5/tradingBot/signal/positions?' + params.toString();
        const ts = new Date().toISOString();
        const sign = signRequestWithCreds(creds, ts, "GET", path);
        const resp = await fetchOkx(path, {
          method: "GET",
          headers: {
            "OK-ACCESS-KEY": creds.key,
            "OK-ACCESS-SIGN": sign,
            "OK-ACCESS-TIMESTAMP": ts,
            "OK-ACCESS-PASSPHRASE": creds.pass,
            ...(OKX_SIMULATED ? { "x-simulated-trading": "1" } : {}),
          },
        });
        const json = await resp.json();
        if (json?.code === "0" && Array.isArray(json.data)) {
          const hasOpen = json.data.some((p) => Math.abs(Number(p.pos || 0)) > 0);
          open = hasOpen ? 1 : 0;
          return true;
        }
        return false;
      };

      if (resolvedCredIdx !== undefined && credsList[resolvedCredIdx]) {
        await fetchOpenWithCreds(credsList[resolvedCredIdx]);
      } else {
        await fetchOkxMultiSigned(
          () => {
            const params = new URLSearchParams({ algoId, algoOrdType: "contract" });
            const path = '/api/v5/tradingBot/signal/positions?' + params.toString();
            return { path, method: "GET" };
          },
          (arr) => {
            for (const r of arr) {
              if (r.json?.code === "0" && Array.isArray(r.json.data)) {
                const hasOpen = r.json.data.some((p) => Math.abs(Number(p.pos || 0)) > 0);
                open = hasOpen ? 1 : 0;
                resolvedCredIdx = r.credIdx;
                break;
              }
            }
          }
        );
      }
    } catch (err) {
      console.warn("⚠️ bot-trades positions error:", err);
    }

    const total = closed + open;
    const payload = {
      algoId,
      credIdx: resolvedCredIdx,
      closed,
      open,
      total,
      ts: Date.now(),
    };
    botTradesCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("❌ /api/bot-trades error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});
// =========================
//  START SERVER
// =========================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running: http://localhost:${PORT}`);
});

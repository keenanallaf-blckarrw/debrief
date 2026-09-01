// Convert a broker timestamp to a sortable string key without relying on the browser's
// Date parser (Safari rejects "MM/DD/YYYY HH:MM:SS", which silently broke direction detection).
export function stampKey(s) {
  const str = String(s || "").trim();
  let m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return m[3] + m[1].padStart(2, "0") + m[2].padStart(2, "0") + m[4].padStart(2, "0") + m[5] + (m[6] || "00");
  m = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return m[1] + m[2] + m[3] + m[4].padStart(2, "0") + m[5] + (m[6] || "00");
  const d = new Date(str);
  return isNaN(d) ? null : d.toISOString().replace(/\D/g, "").slice(0, 14);
}

// Preset: TradingView/Tradovate "Position History" export. No Side column — direction
// is derived from fill order: bought first = Long, sold first = Short. Entry/exit swap accordingly.
export function parsePositionHistory(rows) {
  const h = Object.keys(rows[0] || {}).map((k) => k.trim());
  if (!(h.includes("Bought Timestamp") && h.includes("Sold Timestamp") && h.includes("Buy Price") && h.includes("Sell Price"))) return null;
  const get = (r, name) => r[name] !== undefined ? r[name] : r[Object.keys(r).find((k) => k.trim() === name)];
  let unparsed = 0;
  const trades = rows
    .map((r) => {
      const bRaw = get(r, "Bought Timestamp"), sRaw = get(r, "Sold Timestamp");
      const bk = stampKey(bRaw), sk = stampKey(sRaw);
      let long = true;
      if (bk && sk) long = bk <= sk; else unparsed++;
      const openT = long ? bRaw : sRaw;
      const closeT = long ? sRaw : bRaw;
      return {
        instrument: get(r, "Contract") || get(r, "Product") || "",
        direction: long ? "Long" : "Short",
        size: get(r, "Paired Qty") || "",
        entry: long ? get(r, "Buy Price") : get(r, "Sell Price"),
        exit: long ? get(r, "Sell Price") : get(r, "Buy Price"),
        result: get(r, "P/L") || "",
        date: get(r, "Trade Date") || extractDate(openT),
        time: openT + " → " + closeT,
      };
    })
    .filter((t) => t.instrument);
  if (!trades.length) return null;
  trades.unparsedCount = unparsed;
  return trades;
}

// Guess which CSV column means what. User confirms/corrects in the mapping preview.
export function detectColumns(headers) {
  const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const find = (subs) => {
    for (const sub of subs) {
      const hit = headers.find((k) => clean(k).includes(sub));
      if (hit) return hit;
    }
    return "";
  };
  return {
    sym: find(["symbol", "instrument", "ticker", "contract", "market"]),
    side: find(["side", "direction", "position", "action", "buysell", "type"]),
    qty: find(["qty", "quantity", "contracts", "size", "volume", "amount"]),
    entry: find(["avgentryprice", "entryprice", "openprice", "avgopen", "pricein", "buyprice", "avgprice", "entry"]),
    exit: find(["avgexitprice", "exitprice", "closeprice", "avgclose", "priceout", "sellprice", "exit"]),
    pnl: find(["realizedpl", "realizedpnl", "netpl", "netpnl", "netprofit", "pnl", "pl", "profit"]),
    open: find(["opentime", "opendate", "entrytime", "created", "opening", "time", "date"]),
    close: find(["closetime", "closedate", "exittime", "closing", "closed"]),
  };
}

// Direction from a side value: handles Sell/Short/S/SLD/SS, negative qty, and manual flip.
export function toDirection(sideVal, qtyVal, flip) {
  const v = String(sideVal || "").toLowerCase().trim();
  let isShort = /\b(sell|short|sld|ss|sellshort)\b/.test(v) || v === "s" || v === "-1";
  if (!v && parseFloat(qtyVal) < 0) isShort = true;
  if (flip) isShort = !isShort;
  return isShort ? "Short" : "Long";
}

export function buildTrades(rows, m, flip) {
  const trades = rows
    .map((r) => {
      const openVal = String(m.open ? r[m.open] : "");
      return {
        instrument: m.sym ? r[m.sym] : "",
        direction: toDirection(m.side ? r[m.side] : "", m.qty ? r[m.qty] : "", flip),
        size: m.qty ? String(r[m.qty]).replace("-", "") : "",
        entry: m.entry ? r[m.entry] : "",
        exit: m.exit ? r[m.exit] : "",
        result: m.pnl ? r[m.pnl] : "",
        date: extractDate(openVal),
        time: openVal + (m.close && r[m.close] ? " → " + r[m.close] : ""),
      };
    })
    .filter((t) => t.instrument);
  return trades.length ? trades : null;
}

// Pull a calendar date out of a broker timestamp string, tolerant of formats.
export function extractDate(s) {
  if (!s) return "";
  const str = String(s);
  const iso = str.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const us = str.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (us) {
    const yr = us[3].length === 2 ? "20" + us[3] : us[3];
    return `${yr}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const d = new Date(str);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

// Deterministic CSV → trades. Recognizes TradingView Position History and most broker exports.
export function normalizeRows(rows) {
  if (!rows || !rows.length) return null;
  const headers = Object.keys(rows[0] || {});
  const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const find = (subs) => {
    for (const sub of subs) {
      const hit = headers.find((k) => clean(k).includes(sub));
      if (hit) return hit;
    }
    return null;
  };
  const cSym = find(["symbol", "instrument", "ticker", "contract", "market"]);
  const cSide = find(["side", "direction", "action", "type"]);
  const cQty = find(["qty", "quantity", "contracts", "size", "volume", "amount"]);
  const cEntry = find(["avgentryprice", "entryprice", "openprice", "avgopen", "pricein", "buyprice", "entry"]);
  const cExit = find(["avgexitprice", "exitprice", "closeprice", "avgclose", "priceout", "sellprice", "exit"]);
  const cPnl = find(["realizedpl", "realizedpnl", "netpl", "netpnl", "netprofit", "pnl", "pl", "profit"]);
  const cOpen = find(["opentime", "opendate", "entrytime", "created", "opening", "time", "date"]);
  const cClose = find(["closetime", "closedate", "exittime", "closing", "closed"]);
  if (!cSym || (!cEntry && !cPnl)) return null;
  const trades = rows
    .map((r) => {
      const sideRaw = clean(cSide ? r[cSide] : "");
      const openVal = String(cOpen ? r[cOpen] : "");
      return {
        instrument: r[cSym] || "",
        direction: sideRaw.includes("sell") || sideRaw.includes("short") ? "Short" : "Long",
        size: cQty ? r[cQty] : "",
        entry: cEntry ? r[cEntry] : "",
        exit: cExit ? r[cExit] : "",
        result: cPnl ? r[cPnl] : "",
        date: extractDate(openVal),
        time: openVal + (cClose && r[cClose] ? " → " + r[cClose] : ""),
      };
    })
    .filter((t) => t.instrument);
  return trades.length ? trades : null;
}

export function parseJSON(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {}
  // Model added chatter around the JSON — extract the outermost object and parse that.
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch {}
  }
  return null;
}

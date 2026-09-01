import { useState, useEffect } from "react";
import Papa from "papaparse";
import { callClaude, callClaudeBlocks, callClaudeHistory, aiEnabled, AIUnavailableError } from "./api.js";

// Beta premium unlock code — change this before sharing, and hand it only to premium testers.
const PREMIUM_CODE = "DEBRIEF-EARLY";

// ---------- Deterministic analytics engine (the "tool") ----------
// All numbers the AI sees are computed here, in code, never guessed by the model.
function computeAnalytics(trades) {
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; };
  const key = (t) => {
    const m = String(t.time || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return { d: `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`, h: parseInt(m[4]), mins: parseInt(m[4])*60+parseInt(m[5]), s: (parseInt(m[4])*3600)+(parseInt(m[5])*60)+parseInt(m[6]||0) };
    return { d: t.date || "", h: null, mins: null, s: null };
  };
  const enriched = trades.map((t) => ({ ...t, pnlN: num(t.result), qtyN: Math.abs(num(t.size)), k: key(t) }));
  const agg = (list) => {
    const n = list.length; if (!n) return null;
    const wins = list.filter((t) => t.pnlN > 0);
    const net = list.reduce((a, t) => a + t.pnlN, 0);
    return { n, net: Math.round(net * 100) / 100, winRate: Math.round(100 * wins.length / n), avgWin: wins.length ? Math.round(wins.reduce((a,t)=>a+t.pnlN,0)/wins.length) : 0, avgLoss: (n-wins.length) ? Math.round(list.filter(t=>t.pnlN<=0).reduce((a,t)=>a+t.pnlN,0)/(n-wins.length)) : 0 };
  };
  const groupBy = (fn) => { const g = {}; enriched.forEach((t) => { const k = fn(t); if (k===null||k===undefined||k==="") return; (g[k]=g[k]||[]).push(t); }); return Object.fromEntries(Object.entries(g).map(([k,v])=>[k, agg(v)])); };
  // streaks
  let streak=0, worstStreak=0, run=0, worstRun=0;
  enriched.forEach((t)=>{ if(t.pnlN<0){streak++;run+=t.pnlN; if(streak>worstStreak){worstStreak=streak;} if(run<worstRun)worstRun=run;} else {streak=0;run=0;} });
  // revenge: entry within 2 min of a losing close (needs seconds; approximate via sequence order)
  let revenge = { count: 0, net: 0 };
  for (let i=1;i<enriched.length;i++){
    const prev=enriched[i-1], cur=enriched[i];
    if (prev.pnlN<0 && prev.k.d===cur.k.d && cur.k.mins!==null && prev.k.mins!==null && cur.k.mins-prev.k.mins>=0 && cur.k.mins-prev.k.mins<=2) { revenge.count++; revenge.net+=cur.pnlN; }
  }
  revenge.net = Math.round(revenge.net*100)/100;
  // size after win vs loss
  let aw=[], al=[];
  for (let i=1;i<enriched.length;i++){ (enriched[i-1].pnlN>0?aw:al).push(enriched[i].qtyN); }
  const avg=(a)=>a.length?Math.round(10*a.reduce((x,y)=>x+y,0)/a.length)/10:null;
  return {
    total: agg(enriched),
    byDay: groupBy((t)=>t.k.d||t.date),
    byInstrument: groupBy((t)=>t.instrument),
    byDirection: groupBy((t)=>t.direction),
    byHour: groupBy((t)=>t.k.h===null?"":String(t.k.h).padStart(2,"0")+":00"),
    worstStreak: { losses: worstStreak, drawdown: Math.round(worstRun*100)/100 },
    quickReentriesAfterLoss: revenge,
    avgSizeAfterWin: avg(aw), avgSizeAfterLoss: avg(al),
  };
}

// ---------- Persistent per-user storage ----------
async function saveAppState(state) {
  try { if (window.storage) await window.storage.set("debrief-state", JSON.stringify(state), false); } catch (e) { console.error("save failed", e); }
}
async function loadAppState() {
  try { if (window.storage) { const r = await window.storage.get("debrief-state", false); return r ? JSON.parse(r.value) : null; } } catch (e) { return null; }
  return null;
}

// ---------------- Theme ----------------
const T = {
  bg: "#000000",
  panel: "#0A0A0B",
  soft: "#1C1C1E",
  line: "#2C2C2E00",
  border: "#2C2C2E",
  text: "#F5F5F7",
  muted: "#8E8E93",
  amber: "#D8A94B",
  green: "#30D158",
  red: "#FF453A",
};

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500&display=swap');
`;
const FD = `-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif`; // display
const FB = `-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif`; // body
const FM = `'SF Mono', 'IBM Plex Mono', ui-monospace, monospace`; // data / mono

const STRATEGIES = [
  "Fibonacci", "SMT Divergence", "ICT Concepts", "Order Blocks",
  "Supply / Demand", "VWAP", "Breakouts", "News Trading", "My Own Strategy",
];
const MARKETS = ["Futures", "Forex", "Stocks", "Crypto", "Options"];
const EMOTIONS = ["Calm", "Confident", "FOMO", "Revenge", "Anxious", "Bored", "Tilted"];


// Convert a broker timestamp to a sortable string key without relying on the browser's
// Date parser (Safari rejects "MM/DD/YYYY HH:MM:SS", which silently broke direction detection).
function stampKey(s) {
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
function parsePositionHistory(rows) {
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
function detectColumns(headers) {
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
function toDirection(sideVal, qtyVal, flip) {
  const v = String(sideVal || "").toLowerCase().trim();
  let isShort = /\b(sell|short|sld|ss|sellshort)\b/.test(v) || v === "s" || v === "-1";
  if (!v && parseFloat(qtyVal) < 0) isShort = true;
  if (flip) isShort = !isShort;
  return isShort ? "Short" : "Long";
}

function buildTrades(rows, m, flip) {
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
function extractDate(s) {
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
function normalizeRows(rows) {
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

function parseJSON(text) {
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

// ---------------- Small UI pieces ----------------
function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 15px", borderRadius: 999, cursor: "pointer",
        fontFamily: FB, fontSize: 13.5, fontWeight: 500,
        border: `1px solid ${active ? "transparent" : T.border}`,
        background: active ? T.amber : "transparent",
        color: active ? "#0A0704" : T.muted, transition: "all .15s",
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 130 }}>
      <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.muted }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: T.soft, border: `1px solid ${T.border}`, borderRadius: 12,
  padding: "10px 12px", color: T.text, fontFamily: FB,
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
};

function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.muted, fontFamily: FM, fontSize: 13, padding: "14px 0" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: T.amber, animation: "pulse 1s infinite" }} />
      {label}
    </div>
  );
}

// ---------------- Onboarding ----------------
function Onboarding({ onDone }) {
  const [name, setName] = useState("");
  const [markets, setMarkets] = useState([]);
  const [strats, setStrats] = useState([]);
  const [desc, setDesc] = useState("");
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 24px 56px" }}>
      <div style={{ fontFamily: FM, color: T.amber, fontSize: 12, letterSpacing: 3, textTransform: "uppercase", marginBottom: 18, fontWeight: 500 }}>Debrief</div>
      <h1 style={{ fontFamily: FD, fontSize: 52, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, margin: "0 0 16px", color: T.text }}>
        Know exactly<br />what you did.
      </h1>
      <p style={{ color: T.muted, fontSize: 18, lineHeight: 1.55, marginBottom: 48, maxWidth: 480, fontWeight: 400 }}>
        Debrief reads your trades and grades your process against your own rules. No signals. No opinions. Just an honest mirror.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <Field label="What should we call you">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>

        <div>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.muted, marginBottom: 10, fontWeight: 500 }}>Markets you trade</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {MARKETS.map((m) => <Chip key={m} label={m} active={markets.includes(m)} onClick={() => toggle(markets, setMarkets, m)} />)}
          </div>
        </div>

        <div>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.muted, marginBottom: 10, fontWeight: 500 }}>Your strategy stack</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {STRATEGIES.map((s) => <Chip key={s} label={s} active={strats.includes(s)} onClick={() => toggle(strats, setStrats, s)} />)}
          </div>
        </div>

        <Field label="Your rules, in your own words">
          <textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. I wait for SMT divergence between ES and NQ, then enter on a 61.8 fib retrace of the displacement leg. Stop below the swing. No trades in the first 5 minutes." />
        </Field>

        <button
          onClick={() => name && markets.length && strats.length && onDone({ name, markets, strats, desc })}
          style={{
            alignSelf: "flex-start", padding: "15px 30px", borderRadius: 980, border: "none", cursor: "pointer",
            background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em",
            opacity: name && markets.length && strats.length ? 1 : 0.35,
            transition: "opacity .2s, transform .15s",
          }}
        >
          Start my journal
        </button>
      </div>
    </div>
  );
}

// ---------------- Trade Review Card ----------------
function ReviewBlock({ review }) {
  if (!review) return null;
  const gradeColor = ["A", "B"].includes(review.grade) ? T.green : review.grade === "C" ? T.amber : T.red;
  return (
    <div style={{ borderLeft: `3px solid ${T.amber}`, background: "rgba(232,163,61,0.05)", padding: "14px 16px", marginTop: 12, borderRadius: "0 10px 10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 22, color: gradeColor }}>{review.grade}</span>
        <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted }}>Debrief review</span>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.6 }}>{review.summary}</p>
      {(review.ruleCheck || []).map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5, marginBottom: 5 }}>
          <span style={{ color: r.status === "followed" ? T.green : r.status === "broken" ? T.red : T.muted, fontFamily: FM }}>
            {r.status === "followed" ? "✓" : r.status === "broken" ? "✕" : "?"}
          </span>
          <span><strong>{r.rule}:</strong> <span style={{ color: T.muted }}>{r.note}</span></span>
        </div>
      ))}
      {review.question && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, fontStyle: "italic", color: T.amber }}>↳ {review.question}</p>
      )}
    </div>
  );
}

// ---------------- Journal Tab ----------------
// ---------------- Ask your debrief (premium) ----------------
function AskDebrief({ profile, session, trades }) {
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setQ("");
    const nextMsgs = [...msgs, { role: "user", content: question }];
    setMsgs(nextMsgs);
    setBusy(true);
    const context = `You are Debrief's Q&A engine. The trader is asking about their own debrief. You NEVER give buy/sell advice, predictions, or signals — process, behavior, and context only. Be direct and specific, cite their actual numbers. Keep answers under 150 words.

Trader profile: strategies ${profile.strats.join(", ")}; stated rules "${profile.desc || "not provided"}".
Their debrief: grade ${session.grade}. Summary: ${session.summary} Patterns: ${(session.patterns || []).join(" | ")}
Exact stats: ${JSON.stringify(session.stats)}
${session.deep ? `Deep analytics: ${JSON.stringify(session.deep)}` : ""}
Sample of their trades: ${JSON.stringify(trades.filter((t) => t.synced).slice(0, 40).map((t) => ({ sym: t.instrument, dir: t.direction, pnl: t.result, d: t.date, time: t.time })))}`;
    try {
      const history = nextMsgs.map((m) => ({ role: m.role, content: m.content }));
      history[0] = { role: "user", content: context + "\n\nTrader's question: " + nextMsgs[0].content };
      const answer = await callClaudeHistory(history);
      setMsgs((m) => [...m, { role: "assistant", content: answer }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: "assistant", content: err instanceof AIUnavailableError ? err.message : "Couldn't answer that right now — try again in a moment." }]);
    }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.amber}33` }}>
      <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: T.amber, marginBottom: 10 }}>Ask your debrief</div>
      {msgs.map((m, i) => (
        <div key={i} style={{ marginBottom: 10, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
          <div style={{
            maxWidth: "85%", padding: "10px 14px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap",
            background: m.role === "user" ? T.soft : "rgba(232,163,61,0.08)",
            border: m.role === "user" ? `1px solid ${T.border}` : `1px solid ${T.amber}44`,
          }}>{m.content}</div>
        </div>
      ))}
      {busy && <Spinner label="Checking your numbers..." />}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder='e.g. "why was Aug 18 an F?" or "what happens to my size after two losses?"'
          style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
        <button onClick={ask} disabled={busy} style={{ padding: "10px 18px", borderRadius: 12, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 700, fontSize: 13 }}>Ask</button>
      </div>
    </div>
  );
}

function Journal({ profile, trades, setTrades, session, setSession, premium, onWantPremium }) {
  const blank = { instrument: "", direction: "Long", entry: "", exit: "", size: "", result: "", emotion: "Calm", notes: "" };
  const [f, setF] = useState(blank);
  const [showManual, setShowManual] = useState(false);
  const [pasted, setPasted] = useState("");
  const [doc, setDoc] = useState(null); // {kind:'pdf'|'text', data, name}
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState("");
  const [replay, setReplay] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);
  const [csvRows, setCsvRows] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [csvPreset, setCsvPreset] = useState(null);
  const [freeTrim, setFreeTrim] = useState(null);
  const [flip, setFlip] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const reviewSession = async (batch) => {
    setSyncing(true);
    setSyncErr("");
    const dates = [...new Set(batch.map((t) => t.date).filter(Boolean))];
    const period = dates.length > 1;

    // Exact stats computed locally — real math, not AI estimates.
    const pnls = batch.map((t) => parseFloat(String(t.result).replace(/[^0-9.-]/g, ""))).filter((n) => !isNaN(n));
    const wins = pnls.filter((n) => n > 0).length;
    let streak = 0, worstStreak = 0;
    pnls.forEach((n) => { if (n < 0) { streak++; worstStreak = Math.max(worstStreak, streak); } else streak = 0; });
    const stats = {
      trades: batch.length,
      days: dates.length || 1,
      winRate: pnls.length ? Math.round((wins / pnls.length) * 100) + "%" : "n/a",
      netPnl: pnls.length ? pnls.reduce((a, b) => a + b, 0).toFixed(2) : "n/a",
      avgTradesPerDay: dates.length ? Math.round(batch.length / dates.length) : batch.length,
      worstLosingStreak: worstStreak,
    };

    const compact = batch.map((t) => ({ i: t.idx, sym: t.instrument, dir: t.direction, pnl: t.result, d: t.date, time: t.time }));

    // Premium: full deterministic analytics bundle (hourly edge map, revenge trades, size-after-loss, per-instrument splits).
    const deep = premium ? computeAnalytics(batch) : null;

    const prompt = `You are the review engine inside Debrief, a trade journaling app. You NEVER give buy/sell advice. Grade process, not outcome.

Trader: strategies ${profile.strats.join(", ")}; stated rules "${profile.desc || "not provided"}"; markets ${profile.markets.join(", ")}.

EXACT stats (locally computed, trust these numbers): ${JSON.stringify(stats)}
${deep ? `DEEP ANALYTICS (locally computed, trust these numbers — use them to find the trader's edge and their leaks): ${JSON.stringify(deep)}` : ""}
${period ? `This export spans ${dates.length} trading days (${dates[0]} to ${dates[dates.length - 1]}). Debrief the PERIOD: day-of-week tendencies, streak behavior, size changes after wins/losses, which days should have ended earlier.` : "This is a single session. Debrief the day: overtrading, revenge sequences, size creep, chop clusters, rule breaks."}

Trades: ${JSON.stringify(compact)}

${premium
  ? `CRITICAL OUTPUT RULES: sessionSummary max 5 sentences. Max 6 patterns, 15 words each — ground them in the deep analytics (hour-of-day edge, size after losses, quick re-entries, instrument/direction splits). ${period ? 'dayNotes: max 6 entries for the MOST notable days: {"date","grade":"A-F","note":"max 8 words"}. Omit tradeReviews.' : 'tradeReviews: ONLY the 8 most instructive trades by "i" index, notes max 10 words. Omit dayNotes.'} Keep total response short.`
  : `CRITICAL OUTPUT RULES (free tier — keep it genuinely useful but surface-level): sessionSummary max 3 sentences. EXACTLY 2 patterns, 12 words each, from basic stats only. ${period ? "dayNotes: max 2 entries. Omit tradeReviews." : 'tradeReviews: only the 2 most instructive trades. Omit dayNotes.'} Do not mention hour-of-day analysis, revenge-trade counts, or sizing analysis — those are premium depth.`}

Respond ONLY with JSON, no markdown fences:
{"sessionGrade":"A|B|C|D|F","sessionSummary":"...","patterns":["..."],"question":"...","tradeReviews":[...],"dayNotes":[...]}`;
    try {
      const text = await callClaudeBlocks([{ type: "text", text: prompt }]);
      const parsed = parseJSON(text);
      if (!parsed) throw new Error("response was cut off or malformed");
      setSession({
        grade: parsed.sessionGrade, summary: parsed.sessionSummary, patterns: parsed.patterns || [],
        question: parsed.question, dayNotes: parsed.dayNotes || [], stats, deep,
        premiumReview: !!premium,
        label: period ? `${dates[0]} → ${dates[dates.length - 1]} · ${dates.length} days` : (dates[0] || new Date().toDateString()),
        tradeTimes: compact.slice(0, 20).map((c) => `${c.sym} ${c.dir} at ${c.time}`).join("; "),
      });
      const byIdx = {};
      (parsed.tradeReviews || []).forEach((r) => { byIdx[r.i] = r; });
      setTrades((prev) => prev.map((t) => {
        if (!t.synced) return t;
        if (byIdx[t.idx] === undefined) return { ...t, loading: false };
        const r = byIdx[t.idx];
        return { ...t, loading: false, review: { grade: r.grade, summary: r.note, ruleCheck: r.flag && r.flag !== "clean" ? [{ rule: "Flag", status: "broken", note: r.flag }] : [], question: "" } };
      }));
      setLastBatch(null);
    } catch (err) {
      setTrades((prev) => prev.map((t) => ({ ...t, loading: false })));
      setSyncErr(`Your ${batch.length} trades are imported and safe, but the review step failed (${err.message}).`);
    }
    setSyncing(false);
  };

  const replayMarket = async () => {
    if (!session) return;
    setReplaying(true);
    setReplay(null);
    const prompt = `You are the market replay engine inside Debrief, a trade journaling app. You NEVER give buy/sell advice or say what the trader should have traded.

Search the web for what happened in the markets during ${session.label}: scheduled economic data releases (with times ET), Fed/central bank speakers, major headlines, and how ${profile.markets.join(", ")} broadly behaved.

The trader's entries that session: ${session.tradeTimes || "times unavailable"}.

WRITING RULES: plain everyday language, zero finance jargon — the reader should not need to know what any economic release is. Explain like a sharp friend would.

Respond ONLY with JSON, no markdown fences, exactly this shape (BE COMPACT — respect every word limit):
{"headline":"one plain sentence about that session, max 12 words","happened":[{"time":"8:30 AM ET","what":"what dropped or broke, max 8 words","plain":"what that actually means in plain words, max 16 words"}],"yourEntries":"2-3 plain sentences: whether any of THEIR specific entry times sat inside a news window or unusual volatility, and what that meant for the conditions they were trading in","backdrop":"1-2 plain sentences: the bigger risk mood that day they may not have known about"}
Max 4 happened items, chronological. If nothing notable happened, say so in the headline and return an empty happened array.`;
    try {
      const text = await callClaude(prompt, true);
      const parsed = parseJSON(text);
      setReplay(parsed && parsed.headline ? parsed : { raw: text });
    } catch (err) {
      setReplay({ raw: "Couldn't pull market context right now. Try again in a moment." });
    }
    setReplaying(false);
  };

  const handleFile = (file) => {
    if (!file) return;
    setSyncErr("");
    setCsvRows(null); setCsvHeaders([]); setMapping(null); setFlip(false); setCsvPreset(null);
    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const isCsv = name.endsWith(".csv") || name.endsWith(".tsv") || file.type === "text/csv";
    const r = new FileReader();
    if (isPdf) {
      r.onload = () => setDoc({ kind: "pdf", data: r.result.split(",")[1], name: file.name });
      r.readAsDataURL(file);
    } else if (isCsv) {
      r.onload = () => {
        const parsed = Papa.parse(String(r.result).trim(), { header: true, skipEmptyLines: true });
        if (parsed.data && parsed.data.length) {
          const preset = parsePositionHistory(parsed.data);
          if (preset) {
            setCsvPreset(preset);
            setMapping(null);
            setCsvRows(parsed.data);
            setCsvHeaders(Object.keys(parsed.data[0]));
          } else {
            setCsvPreset(null);
            setCsvRows(parsed.data);
            setCsvHeaders(Object.keys(parsed.data[0]));
            setMapping(detectColumns(Object.keys(parsed.data[0])));
          }
          setDoc({ kind: "csv", data: r.result, name: file.name });
        } else {
          setSyncErr("That CSV looks empty or has no header row.");
        }
      };
      r.readAsText(file);
    } else {
      r.onload = () => setDoc({ kind: "text", data: r.result, name: file.name });
      r.readAsText(file);
    }
  };

  const onFile = (e) => handleFile(e.target.files && e.target.files[0]);

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) {
      setSyncErr("That drag didn't carry a real file. If it's in Google Drive or a browser tab, download it first, then drag it straight from Chrome's download bar or Finder.");
      return;
    }
    handleFile(file);
  };

  const syncDay = async () => {
    if (!doc && !pasted.trim()) return;
    setSyncing(true);
    setSyncErr("");

    // Stage 1: deterministic local extraction. Preset formats import directly; other CSVs use the confirmed mapping.
    let localTrades = null;
    if (csvPreset) {
      localTrades = flip ? csvPreset.map((t) => ({ ...t, direction: t.direction === "Long" ? "Short" : "Long", entry: t.exit, exit: t.entry })) : csvPreset;
    } else if (csvRows && mapping) {
      localTrades = buildTrades(csvRows, mapping, flip);
      if (!localTrades) {
        setSyncErr("No trades came through with that column mapping. Check the Instrument column is set correctly above.");
        setSyncing(false);
        return;
      }
    } else if (!doc && pasted.trim().includes(",")) {
      const parsed = Papa.parse(pasted.trim(), { header: true, skipEmptyLines: true });
      localTrades = normalizeRows(parsed.data) || (parsed.data.length ? parsePositionHistory(parsed.data) : null);
    }

    if (localTrades) {
      // Free tier: one day per debrief. Multi-day files get trimmed to the most recent
      // session, with a notice — the full period is a premium feature.
      if (!premium) {
        const dates = [...new Set(localTrades.map((t) => t.date).filter(Boolean))].sort();
        if (dates.length > 1) {
          const latest = dates[dates.length - 1];
          localTrades = localTrades.filter((t) => !t.date || t.date === latest);
          setFreeTrim({ totalDays: dates.length, usedDay: latest });
        } else {
          setFreeTrim(null);
        }
      } else {
        setFreeTrim(null);
      }
      const stamped = localTrades.slice(0, 200).map((t, i) => ({
        ...t, id: Date.now() + i, idx: i, emotion: "", synced: true, notes: "", review: null, loading: true,
      }));
      setTrades((prev) => [...stamped.map(s => ({...s})), ...prev.filter((p) => !p.synced)]);
      setLastBatch(stamped);
      setDoc(null); setPasted("");
      setCsvRows(null); setCsvHeaders([]); setMapping(null); setCsvPreset(null);
      await reviewSession(stamped);
      return;
    }

    // Fallback: AI extraction for PDFs, unstructured text, or unrecognized CSV layouts.
    const instruction = `You are the sync engine inside Debrief, a trade journaling app. You NEVER give buy/sell advice. Grade process, not outcome.

Trader: strategies ${profile.strats.join(", ")}; stated rules "${profile.desc || "not provided"}"; markets ${profile.markets.join(", ")}.

The attached content is their downloaded trade history export. Find the trades/fills, pair entries with exits where possible, then debrief the SESSION against their rules. BE COMPACT: summary max 3 sentences, notes max 10 words. If more than 15 trades, include the 15 most instructive and note the total.

Respond ONLY with JSON, no markdown fences:
{"sessionGrade":"A|B|C|D|F","sessionSummary":"...","patterns":["..."],"question":"...","trades":[{"instrument":"","direction":"Long|Short","entry":"","exit":"","size":"","result":"","time":"","notes":"","grade":"A-F","flag":"issue or 'clean'"}]}
If unreadable, respond with {"error":"specifically what is wrong with the file and what to export instead"}.`;
    const blocks = [];
    if (doc && doc.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.data } });
    } else if (doc) {
      blocks.push({ type: "text", text: `File "${doc.name}" contents:\n${doc.data.slice(0, 30000)}` });
    }
    if (pasted.trim()) blocks.push({ type: "text", text: "Pasted trade log:\n" + pasted.slice(0, 30000) });
    blocks.push({ type: "text", text: instruction });
    try {
      const text = await callClaudeBlocks(blocks);
      const parsed = parseJSON(text);
      if (!parsed || parsed.error) {
        setSyncErr(parsed && parsed.error ? parsed.error : "The AI response came back malformed — usually a very long file. Try the CSV export instead of PDF.");
      } else {
        setSession({ grade: parsed.sessionGrade, summary: parsed.sessionSummary, patterns: parsed.patterns || [], question: parsed.question, label: new Date().toDateString(), stats: null, dayNotes: [], tradeTimes: (parsed.trades || []).map((t) => `${t.instrument} ${t.direction} at ${t.time}`).join("; ") });
        const imported = (parsed.trades || []).map((t, i) => ({
          ...t, id: Date.now() + i, emotion: "", synced: true,
          time: t.time || new Date().toLocaleString(),
          review: { grade: t.grade, summary: t.notes, ruleCheck: t.flag && t.flag !== "clean" ? [{ rule: "Flag", status: "broken", note: t.flag }] : [], question: "" },
          loading: false,
        }));
        setTrades((prev) => [...imported, ...prev]);
        setDoc(null); setPasted("");
      }
    } catch (err) {
      setSyncErr(`Sync failed: ${err.message}`);
    }
    setSyncing(false);
  };

  const logTrade = async () => {
    if (!f.instrument || !f.notes) return;
    const trade = { ...f, id: Date.now(), time: new Date().toLocaleString(), review: null, loading: true };
    setTrades((t) => [trade, ...t]);
    setF(blank);
    const prompt = `You are the review engine inside Debrief, a trade journaling app. You NEVER give buy/sell advice or predictions. You grade process, not outcome.

Trader profile:
- Strategies: ${profile.strats.join(", ")}
- Their stated rules: "${profile.desc || "not provided"}"
- Markets: ${profile.markets.join(", ")}

Trade just logged:
${JSON.stringify(f)}

Review this trade against THEIR stated strategy and rules. Be direct and specific, like a sharp trading mentor. A losing trade that followed the rules can grade well; a winning trade that broke them should not.

Respond ONLY with JSON, no markdown fences, in this shape:
{"grade":"A|B|C|D|F","summary":"2-3 sentence direct assessment","ruleCheck":[{"rule":"short rule name","status":"followed|broken|unclear","note":"one line"}],"question":"one reflective question for the trader"}`;
    try {
      const text = await callClaude(prompt);
      const review = parseJSON(text) || { grade: "?", summary: text.slice(0, 400), ruleCheck: [], question: "" };
      setTrades((t) => t.map((x) => (x.id === trade.id ? { ...x, review, loading: false } : x)));
    } catch (err) {
      const review = { grade: "—", summary: err.message, ruleCheck: [], question: "" };
      setTrades((t) => t.map((x) => (x.id === trade.id ? { ...x, review, loading: false } : x)));
    }
  };

  return (
    <div>
      {/* ---- Sync my day ---- */}
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 24, padding: 24, marginBottom: 20 }}>
        <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em", marginBottom: 6, color: T.text }}>Sync today's trades</div>
        <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.55, margin: "0 0 16px", maxWidth: 480 }}>
          Export your trade history from TradingView or your broker and drop it in. Debrief reads every trade and reviews the whole session at once.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "stretch" }}>
          <label
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            style={{
            flex: 1, minWidth: 220, border: `1.5px dashed ${doc ? T.green : T.border}`, borderRadius: 18,
            padding: "22px 16px", textAlign: "center", cursor: "pointer",
            fontFamily: FB, fontSize: 13.5, fontWeight: 500, color: doc ? T.green : T.muted,
            display: "flex", alignItems: "center", justifyContent: "center", transition: "border-color .15s",
          }}>
            <input type="file" accept=".csv,.pdf,.txt,.tsv,text/csv,application/pdf,text/plain" onChange={onFile} style={{ display: "none" }} />
            {doc ? `✓ ${doc.name}` : "Drop your CSV or PDF here"}
          </label>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="...or paste exported CSV / trade log text"
            style={{ ...inputStyle, flex: 1, minWidth: 220, minHeight: 56, resize: "vertical", fontFamily: FM, fontSize: 12.5 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={syncDay} disabled={syncing || (!doc && !pasted.trim())}
            style={{ padding: "12px 26px", borderRadius: 980, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 600, fontSize: 14.5, opacity: doc || pasted.trim() ? 1 : 0.35 }}>
            {syncing ? "Debriefing…" : "Import & debrief"}
          </button>
          {syncErr && <span style={{ color: T.red, fontSize: 13 }}>{syncErr}</span>}
          {syncErr && lastBatch && (
            <button onClick={() => reviewSession(lastBatch)}
              style={{ padding: "9px 18px", borderRadius: 980, border: `1px solid ${T.amber}`, cursor: "pointer", background: "transparent", color: T.amber, fontFamily: FD, fontWeight: 600, fontSize: 13 }}>
              Retry review
            </button>
          )}
        </div>
        {syncing && <Spinner label="Reading your trades, checking them against your rules..." />}

        {/* ---- Recognized format banner ---- */}
        {csvPreset && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
            <div style={{ fontFamily: FM, fontSize: 12.5, color: T.green, marginBottom: 6 }}>
              ✓ Recognized: TradingView / Tradovate Position History · {csvPreset.length} trades · {csvPreset.filter((t) => t.direction === "Long").length} long / {csvPreset.filter((t) => t.direction === "Short").length} short
            </div>
            <p style={{ color: T.muted, fontSize: 12.5, margin: "0 0 8px", lineHeight: 1.6 }}>
              This format has no direction column — Debrief derives it from fill order (bought first = long, sold first = short) and pairs entry/exit prices accordingly. Spot-check the long/short split above against what you remember.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text, cursor: "pointer" }}>
              <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} style={{ accentColor: T.amber }} />
              Directions look inverted? Flip Long/Short on import
            </label>
          </div>
        )}

        {/* ---- Column mapping preview ---- */}
        {csvRows && mapping && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
            <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: T.amber, marginBottom: 4 }}>
              Check the column mapping · {csvRows.length} rows found
            </div>
            <p style={{ color: T.muted, fontSize: 12.5, margin: "0 0 12px" }}>Confirm each field is reading the right column before importing. Sample values shown from your first row.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
              {[["sym", "Instrument"], ["side", "Direction"], ["qty", "Size"], ["entry", "Entry price"], ["exit", "Exit price"], ["pnl", "P&L"], ["open", "Open time"], ["close", "Close time"]].map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontFamily: FM, fontSize: 10.5, color: T.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                  <select value={mapping[key] || ""} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })} style={{ ...inputStyle, padding: "8px 10px", fontSize: 12.5 }}>
                    <option value="">(none)</option>
                    {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <div style={{ fontFamily: FM, fontSize: 11, color: mapping[key] ? T.green : T.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {mapping[key] ? `→ ${csvRows[0][mapping[key]]}` : "not mapped"}
                  </div>
                </div>
              ))}
            </div>
            {mapping.side && (
              <div style={{ marginTop: 12, fontSize: 12.5, fontFamily: FM, color: T.muted }}>
                Direction values in your file: <span style={{ color: T.text }}>{[...new Set(csvRows.map((r) => String(r[mapping.side])))].slice(0, 6).join(", ")}</span>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: T.text, cursor: "pointer" }}>
              <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} style={{ accentColor: T.amber }} />
              Directions look inverted? Flip Long/Short on import
            </label>
          </div>
        )}
      </div>

      {/* ---- Free tier day-trim notice ---- */}
      {freeTrim && (
        <div style={{ background: T.panel, border: `1px solid ${T.amber}44`, borderRadius: 18, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, color: T.text, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
            Your file covered <strong>{freeTrim.totalDays} days</strong> — free debriefs one session at a time, so this is <strong>{freeTrim.usedDay}</strong>. Premium debriefs the full period: day-by-day grades, week-level patterns, and your time-of-day edge.
          </span>
          <button onClick={onWantPremium}
            style={{ padding: "9px 18px", borderRadius: 980, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 600, fontSize: 13 }}>
            Get Premium
          </button>
        </div>
      )}

      {/* ---- Session debrief ---- */}
      {session && (
        <div style={{ background: "linear-gradient(180deg, rgba(216,169,75,0.07), rgba(216,169,75,0.02))", border: `1px solid ${T.border}`, borderRadius: 24, padding: "28px 26px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
            <span style={{
              fontFamily: FD, fontWeight: 800, fontSize: 44, letterSpacing: "-0.02em", lineHeight: 1,
              color: ["A", "B"].includes(session.grade) ? T.green : session.grade === "C" ? T.amber : T.red,
            }}>{session.grade}</span>
            <div>
              <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 15, color: T.text, letterSpacing: "-0.01em" }}>Your debrief</div>
              <div style={{ fontFamily: FM, fontSize: 11.5, color: T.muted, marginTop: 1 }}>{session.label}</div>
            </div>
          </div>
          {session.stats && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
              {[
                ["Trades", session.stats.trades, T.text],
                ["Win rate", session.stats.winRate, T.text],
                ["Net", session.stats.netPnl, String(session.stats.netPnl).includes("-") ? T.red : T.green],
                ["Avg/day", session.stats.avgTradesPerDay, T.text],
                ["Worst streak", `${session.stats.worstLosingStreak}L`, session.stats.worstLosingStreak >= 4 ? T.red : T.text],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: T.soft, borderRadius: 14, padding: "8px 14px", minWidth: 74 }}>
                  <div style={{ fontFamily: FM, fontSize: 9.5, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontFamily: FM, fontSize: 15, fontWeight: 500, color }}>{val}</div>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: "0 0 14px", fontSize: 15.5, lineHeight: 1.6, color: T.text, fontWeight: 400 }}>{session.summary}</p>
          {session.patterns.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5, marginBottom: 7, color: T.muted }}>
              <span style={{ color: T.amber, flexShrink: 0 }}>—</span><span>{p}</span>
            </div>
          ))}
          {(session.dayNotes || []).length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
              {session.dayNotes.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 13.5, marginBottom: 6, fontFamily: FM }}>
                  <span style={{ color: T.muted, minWidth: 84 }}>{d.date}</span>
                  <span style={{ fontWeight: 700, color: ["A", "B"].includes(d.grade) ? T.green : d.grade === "C" ? T.amber : T.red, minWidth: 14 }}>{d.grade}</span>
                  <span style={{ color: T.text, fontFamily: FB, fontSize: 14 }}>{d.note}</span>
                </div>
              ))}
            </div>
          )}
          {session.question && <p style={{ margin: "16px 0 0", fontSize: 14.5, fontStyle: "italic", color: T.amber, lineHeight: 1.5 }}>{session.question}</p>}
          <button onClick={replayMarket} disabled={replaying}
            style={{ marginTop: 18, padding: "10px 18px", borderRadius: 980, border: `1px solid ${T.border}`, cursor: "pointer", background: T.soft, color: T.text, fontFamily: FD, fontWeight: 600, fontSize: 13.5 }}>
            {replaying ? "Searching that session..." : "What was the market doing?"}
          </button>
          {replaying && <Spinner label="Checking news and data releases around your entry times..." />}
          {replay && replay.raw && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap", color: T.text }}>
              {replay.raw}
            </div>
          )}
          {replay && !replay.raw && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>That session</div>
              <div style={{ fontFamily: FD, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.3, color: T.text, marginBottom: 6 }}>
                {replay.headline}
              </div>
              {(replay.happened || []).map((h, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "11px 0", borderTop: i > 0 ? `1px solid ${T.border}` : "none", marginTop: i === 0 ? 8 : 0 }}>
                  <span style={{ fontFamily: FM, fontSize: 12, color: T.muted, minWidth: 72, flexShrink: 0 }}>{h.time}</span>
                  <span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{h.what}</span>
                    {h.plain && <span style={{ display: "block", fontSize: 13.5, color: T.muted, lineHeight: 1.55, marginTop: 2 }}>{h.plain}</span>}
                  </span>
                </div>
              ))}
              {replay.yourEntries && (
                <div style={{ background: "rgba(216,169,75,0.06)", border: `1px solid ${T.amber}33`, borderRadius: 14, padding: "14px 16px", marginTop: 12 }}>
                  <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.amber, marginBottom: 6 }}>Your entries</div>
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: T.text }}>{replay.yourEntries}</p>
                </div>
              )}
              {replay.backdrop && <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.6, color: T.muted }}>{replay.backdrop}</p>}
              <div style={{ fontFamily: FM, fontSize: 10.5, color: T.muted, marginTop: 12 }}>Context for the journal, not trade advice.</div>
            </div>
          )}

          {/* ---- Ask your debrief (premium) / upsell (free) ---- */}
          {premium ? (
            <AskDebrief profile={profile} session={session} trades={trades} />
          ) : (
            <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 16, border: `1px dashed ${T.amber}66`, background: "rgba(232,163,61,0.04)" }}>
              <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 14, color: T.amber, marginBottom: 4 }}>★ This was the free debrief</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: T.muted }}>
                Premium runs the full analysis engine on your file: your hour-by-hour edge map, quick re-entry patterns after losses, size behavior after wins vs losses, instrument and direction splits — plus you can ask your debrief questions directly and unlock the Playbook decoder.
              </p>
              <button onClick={onWantPremium} style={{ marginTop: 10, padding: "9px 18px", borderRadius: 12, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 700, fontSize: 13 }}>
                Get Premium
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- Manual entry (fallback) ---- */}
      <button onClick={() => setShowManual(!showManual)}
        style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontFamily: FM, fontSize: 12.5, padding: 0, marginBottom: 14 }}>
        {showManual ? "▾ Hide manual entry" : "▸ Log a single trade manually"}
      </button>
      <div style={{ display: showManual ? "block" : "none", background: T.panel, border: `1px solid ${T.border}`, borderRadius: 20, padding: 20, marginBottom: 28 }}>
        <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 17, marginBottom: 16 }}>Log a trade</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <Field label="Instrument"><input style={inputStyle} value={f.instrument} onChange={set("instrument")} placeholder="NQ, EURUSD..." /></Field>
          <Field label="Direction">
            <select style={inputStyle} value={f.direction} onChange={set("direction")}><option>Long</option><option>Short</option></select>
          </Field>
          <Field label="Entry"><input style={inputStyle} value={f.entry} onChange={set("entry")} placeholder="18250" /></Field>
          <Field label="Exit"><input style={inputStyle} value={f.exit} onChange={set("exit")} placeholder="18310" /></Field>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <Field label="Size"><input style={inputStyle} value={f.size} onChange={set("size")} placeholder="2 contracts" /></Field>
          <Field label="Result (R or $)"><input style={inputStyle} value={f.result} onChange={set("result")} placeholder="+1.8R" /></Field>
          <Field label="Emotional state">
            <select style={inputStyle} value={f.emotion} onChange={set("emotion")}>{EMOTIONS.map((e) => <option key={e}>{e}</option>)}</select>
          </Field>
        </div>
        <Field label="Setup & what happened">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={f.notes} onChange={set("notes")}
            placeholder="SMT divergence on ES/NQ at London low, entered on the 61.8 retrace but I jumped in before the candle closed..." />
        </Field>
        <button onClick={logTrade} style={{ marginTop: 14, padding: "11px 24px", borderRadius: 16, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 700, fontSize: 14 }}>
          Log & debrief
        </button>
      </div>

      {trades.length === 0 && (
        <p style={{ color: T.muted, fontSize: 14, textAlign: "center", padding: "30px 0" }}>No trades yet. Log your first one and Debrief will review it against your rules.</p>
      )}
      {trades.map((t, i) => (
        <div key={t.id}>
          {t.date && (i === 0 || trades[i - 1].date !== t.date) && (
            <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, margin: "20px 0 10px", display: "flex", alignItems: "center", gap: 10 }}>
              <span>{t.date}</span>
              <span style={{ flex: 1, height: 1, background: T.border }} />
            </div>
          )}
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 20, padding: "16px 20px", marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "baseline", fontFamily: FM, fontSize: 13 }}>
            <span style={{ color: T.muted, fontSize: 11 }}>{t.time}</span>
            <span style={{ fontWeight: 500, color: T.text, fontSize: 14 }}>{t.instrument}</span>
            <span style={{ color: t.direction === "Long" ? T.green : T.red }}>{t.direction.toUpperCase()}</span>
            {t.entry && <span style={{ color: T.muted }}>{t.entry} → {t.exit || "—"}</span>}
            {t.result && <span style={{ color: String(t.result).includes("-") ? T.red : T.green }}>{t.result}</span>}
            {t.emotion && <span style={{ color: T.muted }}>· {t.emotion}</span>}
            {t.synced && <span style={{ color: T.amber, fontSize: 10.5, border: `1px solid ${T.amber}55`, borderRadius: 7, padding: "1px 6px" }}>SYNCED</span>}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.6, color: T.text }}>{t.notes}</p>
          {t.loading ? <Spinner label="Debriefing your trade..." /> : <ReviewBlock review={t.review} />}
        </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Market Brief Tab ----------------
function MarketBrief({ profile }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setBrief(null);
    const prompt = `Today is ${new Date().toDateString()}. You are the market context engine inside Debrief, a trade journaling app. You NEVER give buy/sell advice, price predictions, or trade recommendations. Context and risk only.

Search the web for today's scheduled economic events and any major market-moving news relevant to: ${profile.markets.join(", ")}.

The trader's strategies: ${profile.strats.join(", ")}. Their stated rules: "${profile.desc || "not provided"}".

WRITING RULES — this trader should NOT need a finance degree to understand a word of it:
- Plain everyday language. Never assume they know what an economic release is or why it matters.
- For each event, explain what it actually is in one simple sentence, then what days with this kind of event have HISTORICALLY tended to do to their specific markets (past tendency, framed as "days like this have tended to...", never a prediction).
- Speak to THEIR strategy by name. If they trade fib retraces, say what tends to happen to retrace levels around data drops. If they use SMT divergence, say when correlated markets historically decouple and print false divergences. Make it concrete to how THEY enter.

Respond ONLY with JSON, no markdown fences, exactly this shape (BE COMPACT — respect every word limit):
{"headline":"one plain sentence, max 12 words, the single most important thing about today","read":"2-3 plain sentences: what kind of day this sets up to be and why, zero jargon","events":[{"time":"7:30 AM","name":"event name","impact":"low|medium|high","plain":"what this event actually is, in plain words, max 14 words","usually":"what days like this have historically tended to do to their markets, max 18 words"}],"strategyNote":"2-3 sentences speaking directly to their named strategies: how days like today have historically interacted with the way they enter, in plain words","windows":[{"span":"1:55–2:30 PM ET","why":"why to size down or stand aside, plain words, max 14 words"}]}
Max 5 events, max 3 windows. If nothing is scheduled, say so in the headline and return empty arrays.`;
    try {
      const text = await callClaude(prompt, true);
      const parsed = parseJSON(text);
      setBrief(parsed && parsed.headline ? parsed : { raw: text });
    } catch (err) {
      setBrief({ raw: err.message });
    }
    setLoading(false);
  };

  const impactColor = { high: T.red, medium: T.amber, low: T.muted };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <p style={{ color: T.muted, fontSize: 14, margin: 0, maxWidth: 460, lineHeight: 1.6 }}>
          Today's calendar and headlines, translated into risk context for your markets.
        </p>
        <button onClick={run} style={{ padding: "10px 22px", borderRadius: 980, border: `1px solid ${T.border}`, cursor: "pointer", background: T.soft, color: T.text, fontFamily: FD, fontWeight: 600, fontSize: 13.5 }}>
          {brief ? "Refresh" : "Run today's brief"}
        </button>
      </div>
      {loading && <Spinner label="Reading today's calendar and headlines..." />}

      {brief && brief.raw && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{brief.raw}</div>
      )}

      {brief && !brief.raw && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 24, padding: "28px 26px" }}>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: T.muted, marginBottom: 10 }}>
            Today · {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          </div>
          <div style={{ fontFamily: FD, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: T.text, marginBottom: 12 }}>
            {brief.headline}
          </div>
          {brief.read && <p style={{ color: T.muted, fontSize: 14.5, lineHeight: 1.65, margin: "0 0 22px", maxWidth: 560 }}>{brief.read}</p>}

          {(brief.events || []).length > 0 && (
            <div style={{ marginBottom: 22 }}>
              {brief.events.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "14px 0", borderTop: `1px solid ${T.border}` }}>
                  <span style={{ fontFamily: FM, fontSize: 12.5, color: T.muted, minWidth: 72, flexShrink: 0 }}>{e.time}</span>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: impactColor[e.impact] || T.muted, flexShrink: 0, position: "relative", top: -1 }} />
                  <span>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: T.text }}>{e.name}</span>
                    {(e.plain || e.note) && <span style={{ display: "block", fontSize: 13.5, color: T.muted, lineHeight: 1.55, marginTop: 3 }}>{e.plain || e.note}</span>}
                    {e.usually && (
                      <span style={{ display: "block", fontSize: 13.5, lineHeight: 1.55, marginTop: 5 }}>
                        <span style={{ fontFamily: FM, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: T.amber, marginRight: 8 }}>Past tendency</span>
                        <span style={{ color: T.text }}>{e.usually}</span>
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {brief.strategyNote && (
            <div style={{ background: T.soft, borderRadius: 16, padding: "16px 18px", marginBottom: 18 }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>
                For your {profile.strats.slice(0, 2).join(" + ")} entries
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: T.text }}>{brief.strategyNote}</p>
            </div>
          )}

          {(brief.windows || []).length > 0 && (
            <div style={{ background: "rgba(216,169,75,0.06)", border: `1px solid ${T.amber}33`, borderRadius: 16, padding: "16px 18px", marginBottom: 18 }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.amber, marginBottom: 10 }}>Stand-aside windows</div>
              {brief.windows.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: i < brief.windows.length - 1 ? 8 : 0 }}>
                  <span style={{ fontFamily: FM, fontSize: 12.5, color: T.text, minWidth: 120, flexShrink: 0 }}>{w.span}</span>
                  <span style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.5 }}>{w.why}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontFamily: FM, fontSize: 11, color: T.muted }}>Context, never signals.</div>
        </div>
      )}
    </div>
  );
}

// ---------------- Playbook Tab ----------------
function Playbook({ profile, trades, premium, onWantPremium }) {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!premium) {
    return (
      <div style={{ background: T.panel, border: `1px dashed ${T.amber}66`, borderRadius: 20, padding: 28, textAlign: "center" }}>
        <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>★ The Playbook is a Premium feature</div>
        <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 480, margin: "0 auto 16px" }}>
          Debrief studies every trade you've imported and writes out your strategy as a formal playbook — the entry criteria you actually use, your exit behavior, your risk habits, and the gaps between what you say you do and what your fills show.
        </p>
        <button onClick={onWantPremium} style={{ padding: "11px 24px", borderRadius: 16, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 700, fontSize: 14 }}>
          Get Premium
        </button>
      </div>
    );
  }

  const run = async () => {
    setLoading(true);
    setBook(null);
    const compact = trades.map((t) => ({ instrument: t.instrument, direction: t.direction, entry: t.entry, exit: t.exit, result: t.result, emotion: t.emotion, notes: t.notes, date: t.date, time: t.time }));
    const analytics = computeAnalytics(trades);
    const prompt = `You are the playbook engine inside Debrief, a trade journaling app. You never give buy/sell advice.

Trader's stated strategies: ${profile.strats.join(", ")}. Their own description: "${profile.desc || "none"}".

DEEP ANALYTICS (locally computed, trust these numbers): ${JSON.stringify(analytics)}

Their logged trades:
${JSON.stringify(compact.slice(0, 120))}

From their actual behavior, decode their real strategy. Ground every claim in the analytics (size after losses, quick re-entries, hour/day edge, instrument splits). Direct, specific, honest. If the sample is small, note it inside the relevant section.

Respond ONLY with JSON, no markdown fences, exactly this shape (BE COMPACT — respect every word limit):
{"styleName":"a name for their actual style, max 6 words","tagline":"one honest sentence describing how they really trade, max 20 words","sections":[{"title":"Entries","body":"max 60 words"},{"title":"Exits","body":"max 50 words"},{"title":"Risk habits","body":"max 50 words, use the sizing and re-entry numbers"},{"title":"Where the edge lives","body":"max 50 words, use the hour and day numbers"}],"gaps":[{"say":"what they claim, max 12 words","fills":"what the fills show, max 14 words"}],"rules":["rule to formalize, max 14 words","...","..."]}
Max 3 gaps, exactly 3 rules.`;
    try {
      const text = await callClaude(prompt);
      const parsed = parseJSON(text);
      setBook(parsed && parsed.styleName ? parsed : { raw: text });
    } catch (err) {
      setBook({ raw: err.message });
    }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <p style={{ color: T.muted, fontSize: 14, margin: 0, maxWidth: 460, lineHeight: 1.6 }}>
          Your strategy, decoded from what you actually did — including the gaps between what you say and what your fills show.
        </p>
        <button onClick={run} disabled={trades.length < 1}
          style={{ padding: "10px 22px", borderRadius: 980, border: `1px solid ${T.border}`, cursor: trades.length ? "pointer" : "not-allowed", background: T.soft, color: T.text, fontFamily: FD, fontWeight: 600, fontSize: 13.5, opacity: trades.length ? 1 : 0.4 }}>
          Decode my strategy
        </button>
      </div>
      {trades.length < 1 && <p style={{ color: T.muted, fontSize: 13 }}>Log at least one trade first. The more you log, the sharper the playbook.</p>}
      {loading && <Spinner label="Reading your trades, writing your playbook..." />}

      {book && book.raw && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{book.raw}</div>
      )}

      {book && !book.raw && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 24, padding: "30px 28px" }}>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: T.amber, marginBottom: 12 }}>Your playbook</div>
          <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: T.text, marginBottom: 8 }}>
            {book.styleName}
          </div>
          {book.tagline && <p style={{ color: T.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 26px", maxWidth: 540 }}>{book.tagline}</p>}

          {(book.sections || []).map((s, i) => (
            <div key={i} style={{ padding: "18px 0", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>{s.title}</div>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: T.text, maxWidth: 560 }}>{s.body}</p>
            </div>
          ))}

          {(book.gaps || []).length > 0 && (
            <div style={{ marginTop: 8, padding: "18px 0", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 14 }}>What you say · What your fills show</div>
              {book.gaps.map((g, i) => (
                <div key={i} style={{ marginBottom: i < book.gaps.length - 1 ? 16 : 0 }}>
                  <div style={{ fontSize: 13.5, color: T.muted, fontStyle: "italic", lineHeight: 1.5 }}>"{g.say}"</div>
                  <div style={{ fontSize: 14, color: T.amber, lineHeight: 1.5, marginTop: 3 }}>{g.fills}</div>
                </div>
              ))}
            </div>
          )}

          {(book.rules || []).length > 0 && (
            <div style={{ marginTop: 8, padding: "20px 0 4px", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 14 }}>Three rules to formalize</div>
              {book.rules.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", marginBottom: 12 }}>
                  <span style={{ fontFamily: FM, fontSize: 13, color: T.amber, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.45 }}>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- App ----------------
export default function App() {
  const [profile, setProfile] = useState(null);
  const [trades, setTrades] = useState([]);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("journal");
  const [premium, setPremium] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [showCode, setShowCode] = useState(false);

  // Restore this user's saved state on open
  useEffect(() => {
    (async () => {
      const s = await loadAppState();
      if (s) {
        if (s.profile) setProfile(s.profile);
        if (s.trades) setTrades(s.trades);
        if (s.session) setSession(s.session);
        if (s.premium) setPremium(true);
      }
      setHydrated(true);
    })();
  }, []);

  // Autosave on change (after hydration, so we don't clobber saved data with empties)
  useEffect(() => {
    if (hydrated) saveAppState({ profile, trades, session, premium });
  }, [profile, trades, session, premium, hydrated]);

  const tryCode = () => {
    if (codeInput.trim().toUpperCase() === PREMIUM_CODE) { setPremium(true); setShowCode(false); }
    else setCodeInput("nope, check the code");
  };

  const resetAll = async () => {
    setProfile(null); setTrades([]); setSession(null); setPremium(false);
    try { if (window.storage) await window.storage.delete("debrief-state", false); } catch (e) {}
  };

  if (!hydrated) return <div style={{ minHeight: "100vh", background: T.bg }} />;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: FB }}>
      <style>{FONTS + `@keyframes pulse {0%,100%{opacity:.3}50%{opacity:1}} select option{background:${T.panel}}`}</style>

      {!aiEnabled && (
        <div
          style={{
            background: `${T.amber}14`,
            borderBottom: `1px solid ${T.amber}44`,
            color: T.text,
            padding: "10px 20px",
            fontSize: 13,
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          <b style={{ color: T.amber }}>Demo mode.</b> Drop a CSV to try it — import, column mapping and
          parsing all run in your browser, and nothing is uploaded. The AI review is off here; it needs a
          backend to hold the API key.
        </div>
      )}

      {!profile ? (
        <Onboarding onDone={setProfile} />
      ) : (
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px 60px" }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 30, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontFamily: FD, fontWeight: 800, fontSize: 22, letterSpacing: "-0.03em", color: T.text }}>
                Debrief<span style={{ color: T.amber }}>.</span>
                {premium && (
                  <span style={{ marginLeft: 8, fontSize: 10, verticalAlign: "middle", color: T.amber, border: `1px solid ${T.amber}66`, borderRadius: 7, padding: "2px 7px", fontFamily: FM, letterSpacing: 1.5 }}>
                    PREMIUM
                    <button onClick={() => setPremium(false)} title="Downgrade to free (testing)"
                      style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: T.muted, fontFamily: FM, fontSize: 10, padding: 0 }}>
                      ✕
                    </button>
                  </span>
                )}
              </div>
              <div style={{ fontFamily: FM, fontSize: 11.5, color: T.muted, marginTop: 2 }}>
                {profile.name} · {profile.strats.join(" + ")} · {new Date().toDateString()}
              </div>
            </div>
            <nav style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {[["journal", "Journal"], ["brief", "Market Brief"], ["playbook", "Playbook"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  style={{
                    padding: "9px 16px", borderRadius: 12, cursor: "pointer", fontSize: 13.5,
                    fontFamily: FD, fontWeight: 600,
                    border: "none", background: tab === id ? T.soft : "transparent",
                    color: tab === id ? T.text : T.muted,
                  }}>
                  {label}
                </button>
              ))}
              {!premium && (
                showCode ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="premium code"
                      style={{ ...inputStyle, padding: "7px 10px", width: 130, fontSize: 12.5 }} />
                    <button onClick={tryCode} style={{ padding: "7px 12px", borderRadius: 12, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontWeight: 700, fontSize: 12.5 }}>Unlock</button>
                  </span>
                ) : (
                  <button onClick={() => setShowCode(true)} style={{ padding: "9px 14px", borderRadius: 12, cursor: "pointer", fontSize: 12.5, border: `1px solid ${T.amber}66`, background: "transparent", color: T.amber, fontFamily: FD, fontWeight: 600 }}>
                    ★ Premium
                  </button>
                )
              )}
            </nav>
          </header>

          {tab === "journal" && <Journal profile={profile} trades={trades} setTrades={setTrades} session={session} setSession={setSession} premium={premium} onWantPremium={() => setShowCode(true)} />}
          {tab === "brief" && <MarketBrief profile={profile} />}
          {tab === "playbook" && <Playbook profile={profile} trades={trades} premium={premium} onWantPremium={() => setShowCode(true)} />}

          <footer style={{ marginTop: 48, paddingTop: 16, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontFamily: FM, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
            <span>Debrief reviews process and explains market context. It never provides buy/sell recommendations, signals, or financial advice. Trading involves substantial risk of loss.</span>
            <button onClick={resetAll} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontFamily: FM, fontSize: 10.5, textDecoration: "underline" }}>reset my data</button>
          </footer>
        </div>
      )}
    </div>
  );
}

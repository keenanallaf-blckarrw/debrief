import { useState } from "react";
import Papa from "papaparse";
import AskDebrief from "./AskDebrief.jsx";
import ReviewBlock from "./ReviewBlock.jsx";
import { computeAnalytics } from "./analytics.js";
import { callClaude, callClaudeBlocks } from "./api.js";
import { EMOTIONS } from "./constants.js";
import { buildTrades, detectColumns, normalizeRows, parseJSON, parsePositionHistory } from "./parsing.js";
import { FB, FD, FM, T } from "./theme.js";
import { Field, Spinner, inputStyle } from "./ui.jsx";

export default function Journal({ profile, trades, setTrades, session, setSession, premium, onWantPremium }) {
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

import { useState } from "react";
import { AIUnavailableError, callClaudeHistory } from "./api.js";
import { FD, FM, T } from "./theme.js";
import { Spinner, inputStyle } from "./ui.jsx";

// ---------------- Journal Tab ----------------
// ---------------- Ask your debrief (premium) ----------------
export default function AskDebrief({ profile, session, trades }) {
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

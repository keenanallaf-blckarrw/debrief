import { useState } from "react";
import { callClaude } from "./api.js";
import { parseJSON } from "./parsing.js";
import { FD, FM, T } from "./theme.js";
import { Spinner } from "./ui.jsx";

// ---------------- Market Brief Tab ----------------
export default function MarketBrief({ profile }) {
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

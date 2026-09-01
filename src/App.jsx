import { useState, useEffect } from "react";
import Journal from "./Journal.jsx";
import MarketBrief from "./MarketBrief.jsx";
import Onboarding from "./Onboarding.jsx";
import Playbook from "./Playbook.jsx";
import { aiEnabled } from "./api.js";
import { PREMIUM_CODE } from "./config.js";
import { loadAppState, saveAppState } from "./storage.js";
import { FB, FD, FM, FONTS, T } from "./theme.js";
import { inputStyle } from "./ui.jsx";

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

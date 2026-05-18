import { useState } from "react";
import { useApp } from "@/context/AppContext";

const DATES = [
  { day: "MON", num: 14 },
  { day: "TUE", num: 15 },
  { day: "WED", num: 16 },
  { day: "THU", num: 17 },
  { day: "FRI", num: 18 },
  { day: "SAT", num: 19 },
  { day: "SUN", num: 20 },
];

const TIMES = ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"];

export default function BookingPage() {
  const { goTo } = useApp();
  const [selDate, setSelDate] = useState(0);
  const [selStart, setSelStart] = useState("9:00 AM");
  const [selEnd, setSelEnd] = useState("5:00 PM");

  const pricePerHr = 3;
  const totalHrs = TIMES.indexOf(selEnd) - TIMES.indexOf(selStart);
  const hrs = Math.max(1, totalHrs);
  const subtotal = hrs * pricePerHr;
  const fee = Math.round(subtotal * 0.15);
  const total = subtotal + fee;

  return (
    <div className="page active" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#0E1F40", padding: "44px 20px 16px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <button style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => goTo("spot")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          </button>
          <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 200 }}>Book your pad</h1>
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", paddingLeft: 30 }}>142 Maple Ave · $3/hr</p>
      </div>
      <div className="s-divider" />
      <div className="s-body">
        {/* Date */}
        <p className="bk-lbl">Select date</p>
        <div className="date-row" style={{ overflowX: "auto" }}>
          {DATES.map((d, i) => (
            <div key={i} className={`date-pill${selDate === i ? " dp-sel" : ""}`} onClick={() => setSelDate(i)} style={{ minWidth: 44 }}>
              <div className="date-pill-day">{d.day}</div>
              <div className="date-pill-num">{d.num}</div>
            </div>
          ))}
        </div>

        {/* Start time */}
        <p className="bk-lbl">Start time</p>
        <div className="time-row" style={{ overflowX: "auto" }}>
          {TIMES.slice(0, 6).map(t => (
            <div key={t} className={`time-opt${selStart === t ? " to-sel" : ""}`} onClick={() => setSelStart(t)} style={{ minWidth: 70 }}>{t}</div>
          ))}
        </div>

        {/* End time */}
        <p className="bk-lbl">End time</p>
        <div className="time-row" style={{ overflowX: "auto" }}>
          {TIMES.slice(TIMES.indexOf(selStart) + 1).map(t => (
            <div key={t} className={`time-opt${selEnd === t ? " to-sel" : ""}`} onClick={() => setSelEnd(t)} style={{ minWidth: 70 }}>{t}</div>
          ))}
        </div>

        {/* Summary */}
        <div className="bk-summary">
          <div className="bk-sum-row"><span className="bk-sum-lbl">Spot</span><span className="bk-sum-val">142 Maple Ave</span></div>
          <div className="bk-sum-row"><span className="bk-sum-lbl">Date</span><span className="bk-sum-val">Apr {DATES[selDate].num}, 2026</span></div>
          <div className="bk-sum-row"><span className="bk-sum-lbl">Time</span><span className="bk-sum-val">{selStart} – {selEnd}</span></div>
          <div className="bk-sum-row"><span className="bk-sum-lbl">{hrs} hr × $3</span><span className="bk-sum-val">${subtotal}</span></div>
          <div className="bk-sum-row"><span className="bk-sum-lbl">Service fee</span><span className="bk-sum-val">${fee}</span></div>
          <div className="bk-sum-row"><span className="bk-sum-lbl">Total</span><span className="bk-sum-val bk-total">${total}</span></div>
        </div>

        <button className="pay-btn" onClick={() => goTo("confirm")}>Pay ${total} →</button>
      </div>
    </div>
  );
}

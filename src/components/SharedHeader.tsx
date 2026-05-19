import { CarIcon } from "@/components/icons";
import { useApp } from "@/context/AppContext";

interface SharedHeaderProps {
  step: string;
  title: string;
  progress: number;
  label?: string;
  showPin?: boolean;
  foundMsg?: string;
}

export default function SharedHeader({ step, title, progress, label, showPin = true, foundMsg }: SharedHeaderProps) {
  const { goTo } = useApp();

  return (
    <div className="s-header">
      <button
        onClick={() => goTo("find")}
        style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", padding: 0, cursor: "pointer", marginBottom: 10 }}
      >
        <span style={{
          fontSize: 14, fontWeight: 600, letterSpacing: "0.08em",
          fontFamily: '"DM Sans", sans-serif', color: "#0E1F40",
        }}>lily pad</span>
      </button>
      <p className="s-step">{step}</p>
      <h1 className="s-title">{title}</h1>
      <div className="prog-wrap">
        <div className="prog-track">
          <div className="prog-fill" style={{ width: `${progress}%` }} />
          {showPin && (
            <>
              <div className="prog-car" style={{ left: `${Math.min(progress, 91)}%` }}>
                <CarIcon />
              </div>
              <div className="prog-pad" />
            </>
          )}
        </div>
        {foundMsg !== undefined && <div className={`found-msg${foundMsg ? " show" : ""}`}>{foundMsg}</div>}
        {label && <p className="prog-lbl">{label}</p>}
      </div>
    </div>
  );
}

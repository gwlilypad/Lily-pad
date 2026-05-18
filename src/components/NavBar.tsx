interface NavBarProps {
  onBack: () => void;
  onHome?: () => void;
  dots: number[];
  currentDot: number;
  onDotClick?: (idx: number) => void;
}

export default function NavBar({ onBack, onHome, dots, currentDot, onDotClick }: NavBarProps) {
  return (
    <div className="s-nav">
      <button className="back-btn" onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.35)" strokeWidth="2">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        <span className="back-lbl">Back</span>
      </button>
      <div className="step-dots">
        {dots.map((_, i) => {
          let cls = "step-dot";
          if (i < currentDot) cls += " sd-done";
          else if (i === currentDot) cls += " sd-active";
          else cls += " sd-locked";
          return (
            <div key={i} className={cls} onClick={() => i < currentDot && onDotClick && onDotClick(i)} />
          );
        })}
      </div>
      {onHome ? (
        <button className="home-icon-btn" onClick={onHome}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.4)" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
      ) : (
        <div style={{ width: 30 }} />
      )}
    </div>
  );
}

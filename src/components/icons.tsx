interface IconProps { scale?: number; }

export function CarIcon({ scale = 1 }: IconProps) {
  const w = 32 * scale;
  const h = 18 * scale;
  return (
    <svg width={w} height={h} viewBox="0 0 32 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ground shadow */}
      <ellipse cx="16" cy="17.3" rx="13" ry="1.1" fill="rgba(0,0,0,0.17)" />

      {/* Main body — low-slung sedan profile */}
      <path d="M2 10 Q2 15 5.5 15 L26.5 15 Q30 15 30 10 L30 8 Q30 7 28 7 L8 7 Z" fill="#f0f2f6" />

      {/* Roof / cabin */}
      <path d="M8 7 Q9.5 2.5 14.5 2 Q19 1.5 22.5 2.5 Q25.5 4 25.5 7 Z" fill="#e8eaee" />

      {/* Windshield — blue-gray tinted */}
      <path d="M8.5 7 Q10 3 14.5 2.2 L16 2.2 L16 7 Z" fill="rgba(82,122,172,0.62)" />

      {/* Rear window — slightly different tint */}
      <path d="M16 7 L16 2.2 Q21 3 25.5 6.5 L25.5 7 Z" fill="rgba(82,122,172,0.50)" />

      {/* A-pillar divider */}
      <line x1="16" y1="2.2" x2="16" y2="7" stroke="rgba(148,155,164,0.55)" strokeWidth="0.6" />

      {/* Body highlight crease */}
      <path d="M5 10.2 Q14.5 9.2 23 9.7 Q27 10 29 10.8"
        stroke="rgba(255,255,255,0.72)" strokeWidth="0.55" fill="none" strokeLinecap="round" />

      {/* Front bumper cap */}
      <path d="M28.5 8 Q30 8 30 10 L30 12.5 Q28.5 12.5 28.5 11 Z" fill="#dce0e6" />

      {/* Rear bumper cap */}
      <path d="M3.5 8 Q2 8 2 10 L2 12.5 Q3.5 12.5 3.5 11 Z" fill="#dce0e6" />

      {/* Headlight */}
      <rect x="29" y="8.8" width="1.8" height="2.2" rx="1.1" fill="rgba(255,252,190,0.92)" />

      {/* Taillight */}
      <rect x="1.2" y="9.3" width="1.4" height="2.2" rx="0.7" fill="rgba(210,42,42,0.88)" />

      {/* Front wheel — dark with inner rim */}
      <circle cx="9" cy="15" r="3.2" fill="#1c2738" />
      <circle cx="9" cy="15" r="2.0" fill="#242e42" />
      <circle cx="9" cy="15" r="0.85" fill="rgba(210,218,228,0.22)" />

      {/* Rear wheel */}
      <circle cx="23" cy="15" r="3.2" fill="#1c2738" />
      <circle cx="23" cy="15" r="2.0" fill="#242e42" />
      <circle cx="23" cy="15" r="0.85" fill="rgba(210,218,228,0.22)" />
    </svg>
  );
}

interface LilyPadIconProps extends IconProps { disc?: boolean; }

export function LilyPadIcon({ scale = 1, disc = false }: LilyPadIconProps) {
  const w = 28 * scale;
  const h = 22 * scale;
  return (
    <svg width={w} height={h} viewBox="0 0 28 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ground shadow — hidden in disc mode (it rotates with the pad and looks wrong) */}
      {!disc && <ellipse cx="14" cy="21.2" rx="11" ry="1.1" fill="rgba(0,0,0,0.18)" />}

      {/* Pad body */}
      {disc ? (
        <>
          <defs>
            <clipPath id="lp-disc-clip">
              <circle cx="14" cy="11" r="10" />
            </clipPath>
          </defs>
          {/* Perfect circle base — no wobble when spinning */}
          <circle cx="14" cy="11" r="10" fill="#3d9932" />
          <g clipPath="url(#lp-disc-clip)">
            {/* Centered sheen — same pivot as disc so it doesn't swing */}
            <ellipse cx="14" cy="11" rx="8" ry="5"
              fill="rgba(141,214,63,0.22)" transform="rotate(-20 14 11)" />
            {/* Veins clipped to circle boundary */}
            <line x1="14" y1="11" x2="25" y2="11"   stroke="rgba(0,58,14,0.22)" strokeWidth="0.75" />
            <line x1="14" y1="11" x2="22" y2="5.5"  stroke="rgba(0,58,14,0.18)" strokeWidth="0.65" />
            <line x1="14" y1="11" x2="22" y2="16.5" stroke="rgba(0,58,14,0.18)" strokeWidth="0.65" />
            <line x1="14" y1="11" x2="17" y2="2"    stroke="rgba(0,58,14,0.14)" strokeWidth="0.55" />
            <line x1="14" y1="11" x2="17" y2="20"   stroke="rgba(0,58,14,0.14)" strokeWidth="0.55" />
            <line x1="14" y1="11" x2="4"  y2="7"    stroke="rgba(0,58,14,0.12)" strokeWidth="0.50" />
            <line x1="14" y1="11" x2="4"  y2="15"   stroke="rgba(0,58,14,0.12)" strokeWidth="0.50" />
            <line x1="14" y1="11" x2="4"  y2="11"   stroke="rgba(0,58,14,0.15)" strokeWidth="0.65" />
          </g>
        </>
      ) : (
        <path d="M14 11 L24 6 A12 9.5 0 1 0 24 16 Z" fill="#3d9932" />
      )}

      {/* Sheen and veins only on the notched version */}
      {!disc && <>
        <ellipse cx="9.5" cy="7.5" rx="6" ry="3.5"
          fill="rgba(141,214,63,0.26)" transform="rotate(-12 9.5 7.5)" />
        <line x1="14" y1="11" x2="25.5" y2="11"  stroke="rgba(0,58,14,0.22)" strokeWidth="0.75" />
        <line x1="14" y1="11" x2="22.5" y2="5.5"  stroke="rgba(0,58,14,0.18)" strokeWidth="0.65" />
        <line x1="14" y1="11" x2="22.5" y2="16.5" stroke="rgba(0,58,14,0.18)" strokeWidth="0.65" />
        <line x1="14" y1="11" x2="17"   y2="1.5"  stroke="rgba(0,58,14,0.14)" strokeWidth="0.55" />
        <line x1="14" y1="11" x2="17"   y2="20.5" stroke="rgba(0,58,14,0.14)" strokeWidth="0.55" />
        <line x1="14" y1="11" x2="3"    y2="7"    stroke="rgba(0,58,14,0.12)" strokeWidth="0.50" />
        <line x1="14" y1="11" x2="3"    y2="15"   stroke="rgba(0,58,14,0.12)" strokeWidth="0.50" />
        <line x1="14" y1="11" x2="2.5"  y2="11"   stroke="rgba(0,58,14,0.15)" strokeWidth="0.65" />
      </>}
    </svg>
  );
}

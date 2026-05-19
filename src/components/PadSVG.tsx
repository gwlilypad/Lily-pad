import { useId } from "react";

export function PadSVG({ size = 110 }: { size?: number }) {
  const uid = useId().replace(/:/g, "");
  const gid = `pg${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={gid} cx="40%" cy="40%" r="60%">
          <stop offset="0%"   stopColor="#8DD63F"/>
          <stop offset="55%"  stopColor="#6aad24"/>
          <stop offset="100%" stopColor="#3d7a0a"/>
        </radialGradient>
      </defs>
      <circle cx="70" cy="70" r="62" fill={`url(#${gid})`}/>
      <path d="M70 70 L70 8 L115 28 Z" fill="#8DD63F"/>
      <g stroke="rgba(255,255,255,0.18)" strokeWidth="1.1" strokeLinecap="round">
        <line x1="70" y1="70" x2="70"  y2="8"/>
        <line x1="70" y1="70" x2="115" y2="28"/>
        <line x1="70" y1="70" x2="130" y2="70"/>
        <line x1="70" y1="70" x2="114" y2="114"/>
        <line x1="70" y1="70" x2="70"  y2="132"/>
        <line x1="70" y1="70" x2="26"  y2="114"/>
        <line x1="70" y1="70" x2="8"   y2="70"/>
        <line x1="70" y1="70" x2="26"  y2="26"/>
      </g>
      <path d="M70 70 L70 8 L115 28 Z" fill="#8DD63F"/>
      <circle cx="70" cy="70" r="62" stroke="rgba(255,255,255,0.1)" strokeWidth="1" fill="none"/>
    </svg>
  );
}

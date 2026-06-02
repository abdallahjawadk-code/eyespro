import { useCallback, useEffect, useRef, useState } from 'react';

interface Pos { x: number; y: number }

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Animated SVG eye that tracks the mouse cursor */
export function EyeLogo() {
  const svgRef   = useRef<SVGSVGElement>(null);
  const rafRef   = useRef<number>(0);
  const targetRef  = useRef<Pos>({ x: 0, y: 0 });
  const currentRef = useRef<Pos>({ x: 0, y: 0 });

  const [pupil, setPupil] = useState<Pos>({ x: 0, y: 0 });
  const [glowStrength, setGlowStrength] = useState(0.5);

  /* Smooth animation loop */
  const tick = useCallback(() => {
    const t = targetRef.current;
    const c = currentRef.current;
    currentRef.current = {
      x: lerp(c.x, t.x, 0.1),
      y: lerp(c.y, t.y, 0.1),
    };
    setPupil({ ...currentRef.current });
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  /* Track mouse globally */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist   = Math.sqrt(dx * dx + dy * dy);
      const angle  = Math.atan2(dy, dx);
      const travel = Math.min(dist / 300, 1);       /* 0 → 1 */
      const max    = 5;                             /* max pupil offset px */

      targetRef.current = {
        x: Math.cos(angle) * max * travel,
        y: Math.sin(angle) * max * travel,
      };
      /* Glow stronger when mouse is near the eye */
      setGlowStrength(Math.max(0.3, 1 - dist / 400));
    };

    window.addEventListener('mousemove', handler, { passive: true });
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  const cx = 18 + pupil.x;
  const cy = 18 + pupil.y;
  const gid = 'eye-' + Math.floor(glowStrength * 10); /* stable id */

  return (
    <svg
      ref={svgRef}
      className="sb-eye"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ '--glow': glowStrength } as React.CSSProperties}
    >
      <defs>
        {/* Soft glow filter */}
        <filter id="eye-glow-f" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Strong glow for iris */}
        <filter id="iris-glow-f" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Iris radial gradient */}
        <radialGradient id={`iris-${gid}`} cx="40%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#c4b8ff" />
          <stop offset="25%"  stopColor="#a089f4" />
          <stop offset="60%"  stopColor="#7c6cf8" />
          <stop offset="100%" stopColor="#3d2fa0" />
        </radialGradient>

        {/* Sclera gradient */}
        <radialGradient id={`sclera-${gid}`} cx="50%" cy="40%" r="65%">
          <stop offset="0%"   stopColor="#e8e4ff" />
          <stop offset="100%" stopColor="#bdb4f0" />
        </radialGradient>

        {/* Outer glow ring gradient */}
        <radialGradient id={`ring-${gid}`} cx="50%" cy="50%" r="50%">
          <stop offset="60%"  stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(130,116,248,.6)" />
        </radialGradient>
      </defs>

      {/* Outer pulsing glow ring */}
      <ellipse
        cx="18" cy="18" rx="17" ry="12"
        fill="none"
        stroke="rgba(130,116,248,.25)"
        strokeWidth="1.5"
        className="eye-outer-ring"
        filter="url(#eye-glow-f)"
      />

      {/* Sclera (eye white) */}
      <ellipse
        cx="18" cy="18" rx="14" ry="9.5"
        fill={`url(#sclera-${gid})`}
      />

      {/* Iris glow halo (behind iris) */}
      <circle
        cx={cx} cy={cy} r="8.5"
        fill="rgba(124,108,248,.18)"
        filter="url(#eye-glow-f)"
      />

      {/* Iris */}
      <circle
        cx={cx} cy={cy} r="7"
        fill={`url(#iris-${gid})`}
        filter="url(#iris-glow-f)"
      />

      {/* Iris detail rings */}
      <circle cx={cx} cy={cy} r="7"   fill="none" stroke="rgba(200,180,255,.3)"  strokeWidth=".5" />
      <circle cx={cx} cy={cy} r="5"   fill="none" stroke="rgba(180,160,255,.18)" strokeWidth=".5" />
      <circle cx={cx} cy={cy} r="3.5" fill="none" stroke="rgba(160,140,255,.12)" strokeWidth=".5" />

      {/* Pupil */}
      <circle cx={cx} cy={cy} r="3.2" fill="#04041a" />

      {/* Primary specular */}
      <circle cx={cx - 1.6} cy={cy - 2} r="1.4"  fill="rgba(255,255,255,.9)" />
      {/* Secondary specular */}
      <circle cx={cx + 1.3} cy={cy + 1} r=".65" fill="rgba(255,255,255,.45)" />

      {/* Upper lid shadow */}
      <ellipse
        cx="18" cy="11.5" rx="14" ry="5.5"
        fill="rgba(4,6,26,.12)"
      />

      {/* Eyelashes — top */}
      {[-10, -5, 0, 5, 10].map((offset, i) => (
        <line
          key={`lash-${i}`}
          x1={18 + offset}
          y1={8.6 - Math.abs(offset) * 0.08}
          x2={18 + offset * 1.1}
          y2={7.2 - Math.abs(offset) * 0.18}
          stroke="rgba(160,140,255,.55)"
          strokeWidth=".7"
          strokeLinecap="round"
        />
      ))}

      {/* Eyelashes — bottom (shorter) */}
      {[-7, 0, 7].map((offset, i) => (
        <line
          key={`lash-b-${i}`}
          x1={18 + offset}
          y1={27.5 + Math.abs(offset) * 0.05}
          x2={18 + offset * 1.05}
          y2={28.6}
          stroke="rgba(160,140,255,.3)"
          strokeWidth=".6"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

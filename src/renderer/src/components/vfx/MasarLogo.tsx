/**
 * MasarLogo — compact, animated, interactive bilingual brand mark for "المسار / Masar".
 * A stylized route ("مسار" = path) draws itself with a glowing pulse travelling along it,
 * beside the bilingual wordmark. Self-contained (scoped styles), no external CSS needed.
 */
import { useId } from 'react';

export function MasarLogo({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  // Unique gradient/path ids so multiple instances don't collide.
  const uid = useId().replace(/[:]/g, '');
  const grad = `masarGrad-${uid}`;
  const route = `masarRoute-${uid}`;
  const scale = size === 'md' ? 1.25 : 1;

  return (
    <span className="masar-logo" style={{ ['--masar-scale' as string]: String(scale) }} role="img" aria-label="المسار · Masar">
      <style>{`
        .masar-logo {
          display: inline-flex; align-items: center; gap: 9px;
          cursor: default; user-select: none;
          transform: scale(var(--masar-scale, 1));
          transition: transform .35s cubic-bezier(.2,.8,.2,1), filter .35s ease;
          will-change: transform, filter;
        }
        .masar-logo:hover { transform: scale(calc(var(--masar-scale,1) * 1.07)); filter: brightness(1.12); }
        .masar-logo svg { display: block; overflow: visible; }
        .masar-route {
          stroke-dasharray: 96; stroke-dashoffset: 96;
          animation: masarDraw 2.6s cubic-bezier(.4,0,.2,1) infinite;
        }
        @keyframes masarDraw {
          0%   { stroke-dashoffset: 96; opacity: .35; }
          45%  { stroke-dashoffset: 0;  opacity: 1; }
          80%  { stroke-dashoffset: 0;  opacity: 1; }
          100% { stroke-dashoffset: -96; opacity: .35; }
        }
        .masar-pulse { filter: drop-shadow(0 0 4px #ff6b6b); }
        .masar-node  { transform-box: fill-box; transform-origin: center; animation: masarNode 2.6s ease-in-out infinite; }
        @keyframes masarNode { 0%,100% { opacity:.55; } 50% { opacity:1; } }
        .masar-logo:hover .masar-route { animation-duration: 1.4s; }
        .masar-logo:hover .masar-pulse-mo { animation-duration: 1.4s !important; }
        .masar-words { display: inline-flex; flex-direction: column; line-height: 1; }
        .masar-ar {
          font-size: 14px; font-weight: 800; letter-spacing: .5px;
          background: linear-gradient(90deg,#ff8a8a,#e63946 60%,#ff8a8a);
          background-size: 200% 100%; -webkit-background-clip: text; background-clip: text;
          color: transparent; animation: masarShine 4s linear infinite;
        }
        .masar-en {
          font-size: 8.5px; font-weight: 700; letter-spacing: 3.5px; margin-top: 2px;
          color: rgba(230,57,70,.78); text-transform: uppercase;
        }
        @keyframes masarShine { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }
        @media (prefers-reduced-motion: reduce) {
          .masar-route, .masar-node, .masar-ar, .masar-pulse-mo { animation: none !important; }
          .masar-route { stroke-dashoffset: 0; opacity: 1; }
        }
      `}</style>

      <svg width="34" height="26" viewBox="0 0 48 36" aria-hidden="true">
        <defs>
          <linearGradient id={grad} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#ff6b6b" />
            <stop offset="1" stopColor="#e63946" />
          </linearGradient>
        </defs>
        {/* the route — a flowing path that draws itself */}
        <path
          id={route}
          className="masar-route"
          d="M4 31 C 15 31, 13 8, 24 8 S 33 30, 44 5"
          fill="none"
          stroke={`url(#${grad})`}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        {/* waypoint nodes */}
        <circle className="masar-node" cx="4" cy="31" r="2.3" fill="#e63946" />
        <circle className="masar-node" cx="44" cy="5" r="2.3" fill="#ff6b6b" style={{ animationDelay: '1.3s' }} />
        {/* glowing pulse travelling along the route */}
        <circle className="masar-pulse" r="2.7" fill="#fff">
          <animateMotion className="masar-pulse-mo" dur="2.6s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
            <mpath href={`#${route}`} />
          </animateMotion>
        </circle>
      </svg>

      <span className="masar-words">
        <span className="masar-ar" dir="rtl">المسار</span>
        <span className="masar-en">Masar</span>
      </span>
    </span>
  );
}

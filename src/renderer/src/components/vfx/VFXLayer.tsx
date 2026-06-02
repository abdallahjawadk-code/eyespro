import { useCallback, useEffect, useRef } from 'react';
import './vfx.css';

interface Pos { x: number; y: number }

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/* ── Particle data ─────────────────────────────────────────── */
const PARTICLE_COUNT = 18;
const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
  id:    i,
  left:  `${(i / PARTICLE_COUNT) * 100 + Math.sin(i * 1.7) * 12}%`,
  delay: `${(i * 0.42) % 7}s`,
  dur:   `${7 + (i % 5) * 1.5}s`,
  size:  i % 3 === 0 ? '3px' : i % 3 === 1 ? '2px' : '1.5px',
  opacity: i % 4 === 0 ? '0.7' : '0.4',
}));

/* ── 3D Card tilt ─────────────────────────────────────────── */
function attachTilt(el: HTMLElement, strength = 12) {
  let raf = 0;
  const targetRot = { x: 0, y: 0 };
  const currentRot = { x: 0, y: 0 };

  const onMove = (e: MouseEvent) => {
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;   /* 0..1 */
    const py = (e.clientY - rect.top)  / rect.height;  /* 0..1 */
    targetRot.x = (0.5 - py) * strength;
    targetRot.y = (px - 0.5) * strength;
    el.style.setProperty('--sheen-x', `${px * 100}%`);
    el.style.setProperty('--sheen-y', `${py * 100}%`);
  };

  const animate = () => {
    currentRot.x = lerp(currentRot.x, targetRot.x, 0.12);
    currentRot.y = lerp(currentRot.y, targetRot.y, 0.12);
    el.style.transform =
      `perspective(900px) rotateX(${currentRot.x}deg) rotateY(${currentRot.y}deg) translateZ(2px)`;
    raf = requestAnimationFrame(animate);
  };

  const onEnter = () => { raf = requestAnimationFrame(animate); };

  const onLeave = () => {
    cancelAnimationFrame(raf);
    targetRot.x = 0; targetRot.y = 0;
    const ease = () => {
      currentRot.x = lerp(currentRot.x, 0, 0.1);
      currentRot.y = lerp(currentRot.y, 0, 0.1);
      el.style.transform =
        `perspective(900px) rotateX(${currentRot.x}deg) rotateY(${currentRot.y}deg)`;
      if (Math.abs(currentRot.x) > 0.05 || Math.abs(currentRot.y) > 0.05) {
        raf = requestAnimationFrame(ease);
      } else {
        el.style.transform = '';
      }
    };
    raf = requestAnimationFrame(ease);
  };

  el.addEventListener('mousemove',  onMove,  { passive: true });
  el.addEventListener('mouseenter', onEnter, { passive: true });
  el.addEventListener('mouseleave', onLeave, { passive: true });

  return () => {
    cancelAnimationFrame(raf);
    el.removeEventListener('mousemove',  onMove);
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', onLeave);
  };
}

/* ── Magnetic button effect ───────────────────────────────── */
function attachMagnetic(el: HTMLElement, range = 60, strength = 0.35) {
  const onMove = (e: MouseEvent) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < range) {
      const pull = (range - dist) / range;
      el.style.transform = `translate(${dx * pull * strength}px, ${dy * pull * strength}px)`;
    }
  };

  const onLeave = () => {
    el.style.transform = '';
  };

  el.addEventListener('mousemove',  onMove,  { passive: true });
  el.addEventListener('mouseleave', onLeave, { passive: true });
  return () => {
    el.removeEventListener('mousemove',  onMove);
    el.removeEventListener('mouseleave', onLeave);
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN VFX LAYER COMPONENT
═══════════════════════════════════════════════════════════ */
export function VFXLayer() {
  const spotRef   = useRef<HTMLDivElement>(null);
  const rafRef    = useRef<number>(0);
  const targetRef  = useRef<Pos>({ x: -999, y: -999 });
  const currentRef = useRef<Pos>({ x: -999, y: -999 });
  const cleanups  = useRef<Array<() => void>>([]);

  /* Smooth spotlight follow using rAF */
  const animateSpot = useCallback(() => {
    const t = targetRef.current;
    const c = currentRef.current;
    currentRef.current = {
      x: lerp(c.x, t.x, 0.07),
      y: lerp(c.y, t.y, 0.07),
    };
    const el = spotRef.current;
    if (el) {
      el.style.setProperty('--sx', `${currentRef.current.x}px`);
      el.style.setProperty('--sy', `${currentRef.current.y}px`);
    }
    rafRef.current = requestAnimationFrame(animateSpot);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animateSpot);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animateSpot]);

  /* Global mouse tracking */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY };

      /* Set CSS vars on :root for other elements to use */
      const root = document.documentElement;
      root.style.setProperty('--mouse-x', `${(e.clientX / window.innerWidth  * 100).toFixed(2)}%`);
      root.style.setProperty('--mouse-y', `${(e.clientY / window.innerHeight * 100).toFixed(2)}%`);
      root.style.setProperty('--mouse-px', `${e.clientX}px`);
      root.style.setProperty('--mouse-py', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handler, { passive: true });
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  /* Attach 3D tilt to tilt-eligible cards and magnetic to primary btns */
  useEffect(() => {
    const interval = setInterval(() => {
      /* Cards — re-scan every 2s to pick up newly mounted cards */
      document.querySelectorAll<HTMLElement>('.card, .react-stat-card, .tilt-card').forEach(el => {
        if (el.dataset.vfxTilt) return;          /* already attached */
        el.dataset.vfxTilt = '1';
        el.classList.add('tilt-card');
        const cleanup = attachTilt(el, 8);       /* gentle 8° max */
        cleanups.current.push(cleanup);
      });

      /* Magnetic buttons */
      document.querySelectorAll<HTMLElement>('.btn-primary, .btn-magnetic').forEach(el => {
        if (el.dataset.vfxMag) return;
        el.dataset.vfxMag = '1';
        const cleanup = attachMagnetic(el, 55, 0.3);
        cleanups.current.push(cleanup);
      });
    }, 2000);

    return () => {
      clearInterval(interval);
      cleanups.current.forEach(fn => fn());
      cleanups.current = [];
    };
  }, []);

  return (
    <>
      {/* Main VFX root */}
      <div className="vfx-root" ref={spotRef} aria-hidden>
        {/* Smooth cursor spotlight */}
        <div className="vfx-spotlight" />

        {/* Floating particles */}
        <div className="vfx-particles">
          {particles.map(p => (
            <span
              key={p.id}
              className="vfx-particle"
              style={{
                left:            p.left,
                bottom:          '-4px',
                animationDelay:  p.delay,
                animationDuration:p.dur,
                width:           p.size,
                height:          p.size,
                opacity:         p.opacity,
              } as React.CSSProperties}
            />
          ))}
        </div>
      </div>

      {/* Corner glows */}
      <div className="vfx-corners" aria-hidden />

      {/* Edge scan line (dark mode only) */}
      <div className="vfx-scanlines" aria-hidden />
    </>
  );
}

#!/usr/bin/env node
/**
 * create-installer-images.cjs
 * Generates two BMP files required by the NSIS / MUI2 installer:
 *
 *   resources/sidebar.bmp   164 × 314 px  — Welcome & Finish page sidebar
 *   resources/header.bmp    150 × 57  px  — Header banner on all other pages
 *
 * Format: 24-bit uncompressed BMP (top-to-bottom, BGR pixel order).
 * No external dependencies — pure Node.js Buffer math.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  navy:      [0x0B, 0x1E, 0x3D],  // #0B1E3D — deep navy
  navyMid:   [0x0F, 0x2A, 0x55],  // #0F2A55 — mid navy
  navyLight: [0x17, 0x3E, 0x7A],  // #173E7A — lighter navy
  gold:      [0xF5, 0x9E, 0x0B],  // #F59E0B — amber/gold
  goldDark:  [0xD4, 0x7D, 0x08],  // #D47D08 — darker gold
  goldPale:  [0xFF, 0xD4, 0x6E],  // #FFD46E — pale gold highlight
  white:     [0xFF, 0xFF, 0xFF],
  offWhite:  [0xF0, 0xF4, 0xFF],  // #F0F4FF — very light blue-white
  darkLine:  [0x08, 0x14, 0x28],  // near-black separator
};

// ── BMP builder ────────────────────────────────────────────────────────────────

/**
 * Create a 24-bit top-down BMP.
 * pixelFn(x, y) must return [r, g, b] with values 0–255.
 */
function makeBmp(width, height, pixelFn) {
  const rowBytes = Math.ceil(width * 3 / 4) * 4; // padded to 4-byte boundary
  const pixelDataSize = rowBytes * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize, 0);

  // ── File header (14 bytes) ──────────────────────────────────────────────────
  buf[0] = 0x42; buf[1] = 0x4D;          // 'BM'
  buf.writeUInt32LE(fileSize, 2);         // file size
  // bytes 6-9 reserved (0)
  buf.writeUInt32LE(54, 10);             // pixel data offset

  // ── DIB / BITMAPINFOHEADER (40 bytes) ──────────────────────────────────────
  buf.writeUInt32LE(40, 14);             // header size
  buf.writeInt32LE(width, 18);           // image width
  buf.writeInt32LE(-height, 22);         // negative → top-down raster
  buf.writeUInt16LE(1, 26);             // colour planes
  buf.writeUInt16LE(24, 28);            // bits per pixel
  buf.writeUInt32LE(0, 30);             // compression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize, 34); // raw image size
  buf.writeInt32LE(2835, 38);           // X pixels/metre (~72 dpi)
  buf.writeInt32LE(2835, 42);           // Y pixels/metre
  // bytes 46-53: colours in table / important colours (0 = all)

  // ── Pixel data ─────────────────────────────────────────────────────────────
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const off = 54 + y * rowBytes + x * 3;
      buf[off]     = b; // BMP stores BGR
      buf[off + 1] = g;
      buf[off + 2] = r;
    }
  }

  return buf;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Linear interpolation between two colours at position t ∈ [0,1]. */
function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Clamp each channel to [0,255]. */
function clamp(c) {
  return [
    Math.max(0, Math.min(255, c[0])),
    Math.max(0, Math.min(255, c[1])),
    Math.max(0, Math.min(255, c[2])),
  ];
}

/** Add a scalar to each channel. */
function brighten(c, d) {
  return clamp([c[0] + d, c[1] + d, c[2] + d]);
}

// ── Sidebar pixel function (164 × 314) ────────────────────────────────────────
//
// Layout (top → bottom):
//   0  –  88 px : Gold header band
//   89 – 91 px  : White hairline separator
//   92 – 313 px : Dark navy body with subtle grid texture + accent dots
//
function sidebarPixel(x, y) {
  const W = 164;
  const H = 314;
  const GOLD_BAND = 88;

  // ── Gold header band ────────────────────────────────────────────────────────
  if (y < GOLD_BAND) {
    const ty = y / GOLD_BAND;
    const base = lerp(C.goldPale, C.gold, ty); // pale gold → amber

    // Subtle diagonal shimmer lines
    if ((x * 2 + y) % 18 === 0) {
      return brighten(base, 20);
    }
    // Fine dot texture
    if (x % 8 === 0 && y % 8 === 0) {
      return lerp(base, C.goldDark, 0.35);
    }
    // Left accent stripe
    if (x < 4) {
      return lerp(C.goldDark, C.darkLine, ty * 0.5);
    }
    return base;
  }

  // ── White separator ─────────────────────────────────────────────────────────
  if (y <= 91) {
    const fade = (y - 89) / 2; // 0 → 1
    return lerp(C.white, C.navyMid, fade);
  }

  // ── Navy body ───────────────────────────────────────────────────────────────
  const bodyY = y - 92;
  const bodyH = H - 92;
  const ty = bodyY / bodyH;

  const base = lerp(C.navy, C.navyLight, ty * 0.6);

  // Left edge dark strip (depth shadow)
  if (x < 4) {
    return lerp(base, C.darkLine, 0.5);
  }

  // Diagonal grid lines (subtle)
  if ((x + y * 2) % 40 === 0) {
    return brighten(base, 12);
  }

  // Horizontal micro-lines at every 40 px in body
  if (bodyY % 40 === 0) {
    return lerp(base, C.navyLight, 0.4);
  }

  // Gold accent dots on a 40×40 grid
  const dotGridX = Math.round((x - 20) / 40) * 40 + 20;
  const dotGridY = 92 + (Math.round(bodyY / 40) * 40) + 20;
  const dist2 = (x - dotGridX) ** 2 + (y - dotGridY) ** 2;
  if (dist2 <= 4) {  // radius 2 px
    return lerp(C.gold, C.goldDark, dist2 / 4);
  }

  // Small corner-cross markers at grid intersections
  if (dotGridX > 0 && dotGridX < W && dist2 <= 16) {
    // ring around dots (softer fade)
  }

  return base;
}

// ── Header pixel function (150 × 57) ──────────────────────────────────────────
//
// Layout (left → right):
//   0  –  56 px  : Square gold panel (matches sidebar top band)
//   57 – 149 px  : Dark navy panel with subtle gradient
//
function headerPixel(x, y) {
  const W = 150;
  const H = 57;
  const GOLD_W = 57; // square panel

  if (x < GOLD_W) {
    // Gold square — same texture as sidebar top band
    const tx = x / GOLD_W;
    const ty = y / H;
    const base = lerp(C.goldPale, C.gold, (tx + ty) / 2);

    if ((x * 2 + y) % 14 === 0) return brighten(base, 18);
    if (x % 6 === 0 && y % 6 === 0) return lerp(base, C.goldDark, 0.3);

    // Right edge separator
    if (x >= GOLD_W - 3) {
      return lerp(base, C.darkLine, (x - (GOLD_W - 3)) / 3);
    }
    return base;
  }

  // Navy panel
  const tx = (x - GOLD_W) / (W - GOLD_W);
  const ty = y / H;
  const base = lerp(C.navy, C.navyLight, tx * 0.5 + ty * 0.2);

  // Top/bottom edge lines
  if (y === 0 || y === H - 1) return lerp(base, C.darkLine, 0.6);

  // Diagonal shimmer
  if ((x + y * 3) % 45 === 0) return brighten(base, 10);

  // Right-side subtle brighter edge
  if (x >= W - 6) {
    return lerp(base, C.navyMid, (x - (W - 6)) / 6);
  }

  return base;
}

// ── Write files ────────────────────────────────────────────────────────────────

const resourcesDir = path.join(__dirname, '..', 'resources');

const sidebarPath = path.join(resourcesDir, 'sidebar.bmp');
const headerPath  = path.join(resourcesDir, 'header.bmp');

console.log('Generating installer images…');

fs.writeFileSync(sidebarPath, makeBmp(164, 314, sidebarPixel));
console.log(`  ✓  sidebar.bmp  (164 × 314)  → ${sidebarPath}`);

fs.writeFileSync(headerPath, makeBmp(150, 57, headerPixel));
console.log(`  ✓  header.bmp   (150 × 57)   → ${headerPath}`);

console.log('Done.');

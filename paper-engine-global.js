// classic-script build of paper-engine.js (exposes window.PaperEngine) so bundling inlines it
(function () {
// Procedural paper texture engine: noise, crumple height field, ruling, export.
// Pure-ish helpers so the UI layer only orchestrates.

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(u, v, n, seed) {
  const fx = u * n, fy = v * n;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const w = (a, b) => hash2(((a % n) + n) % n, ((b % n) + n) % n, seed);
  const a = w(x0, y0), b = w(x0 + 1, y0), c = w(x0, y0 + 1), d = w(x0 + 1, y0 + 1);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function fbm(u, v, base, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, n = base;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, n, seed + o * 97) * amp;
    norm += amp; amp *= 0.5; n *= 2;
  }
  return sum / norm;
}

function hexRgb(hex) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
}

// speckle tile, clumped by a low-frequency noise field
function makeGrain({ size, density, sharpness, clump, octaves, rgb, seed }) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const cn = Math.max(4, Math.round(size / 32));
  const field = new Float32Array(cn * cn);
  for (let y = 0; y < cn; y++)
    for (let x = 0; x < cn; x++) field[y * cn + x] = fbm(x / cn, y / cn, 4, octaves, seed);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cn, y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cn, x0 = Math.floor(fx), tx = fx - x0;
      const g = (a, b) => field[(((b % cn) + cn) % cn) * cn + (((a % cn) + cn) % cn)];
      const top = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
      const bot = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
      const cl = top + (bot - top) * ty;
      let a = 0;
      if (hash2(x, y, seed + 1013) < density * (1 - clump + clump * cl * 2)) {
        a = Math.pow(hash2(x, y, seed + 7717), sharpness);
      }
      const o = (y * size + x) * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function makeFiber(seed, octaves) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 6, octaves, seed);
      const o = (y * size + x) * 4;
      d[o] = 58; d[o + 1] = 42; d[o + 2] = 26;
      d[o + 3] = Math.max(0, n - 0.35) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

// faceted height field: jittered sites per level, each cell a tilted plane,
// so cell borders read as hard creases and interiors stay smooth
function buildHeight({ seed, base, levels, W = 1100, H = 760 }) {
  const h = new Float32Array(W * H);
  for (let l = 0; l < levels; l++) {
    const n = Math.max(2, Math.round(base * Math.pow(1.9, l)));
    const amp = Math.pow(0.45, l);
    const ny = Math.max(2, Math.round((n * H) / W));
    const rot = hash2(l, 7, seed) * Math.PI;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const stretch = 1.1 + hash2(l, 19, seed) * 0.5;
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const rx = (u - 0.5) * ca - (v - 0.5) * sa + 0.5;
        const ry = (u - 0.5) * sa + (v - 0.5) * ca + 0.5;
        const gx = rx * n * stretch, gy = (ry * ny) / stretch;
        const cx0 = Math.floor(gx), cy0 = Math.floor(gy);
        let bd = 1e9, bcx = 0, bcy = 0, bsx = 0, bsy = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = cx0 + dx, cy = cy0 + dy;
            const sx = cx + 0.15 + hash2(cx, cy, seed + l * 131 + 11) * 0.7;
            const sy = cy + 0.15 + hash2(cx, cy, seed + l * 197 + 566) * 0.7;
            const ddx = gx - sx, ddy = gy - sy;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < bd) { bd = d2; bcx = cx; bcy = cy; bsx = sx; bsy = sy; }
          }
        }
        const t1 = hash2(bcx, bcy, seed + l * 313 + 3);
        const t2 = hash2(bcx, bcy, seed + l * 313 + 91);
        const off = hash2(bcx, bcy, seed + l * 313 + 47) - 0.5;
        h[y * W + x] += (off * 0.9 + ((gx - bsx) * (t1 - 0.5) + (gy - bsy) * (t2 - 0.5)) * 1.5) * amp;
      }
    }
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) h[y * W + x] += (fbm(x / W, y / H, 3, 3, seed + 5) - 0.5) * 1.2;
  return { W, H, h };
}

// lambert-shade a height field into a canvas as a neutral-grey relief map
function shade(field, canvas, lightAngle, amount, store) {
  if (!field || !canvas) return;
  const W = field.W, H = field.H, h = field.h;
  if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  if (!store.img || store.img.width !== W) store.img = ctx.createImageData(W, H);
  const d = store.img.data;
  const a = (lightAngle * Math.PI) / 180;
  const lx = Math.cos(a) * 0.72, ly = Math.sin(a) * 0.72, lz = 0.62;
  const ln = Math.hypot(lx, ly, lz);
  const Lx = lx / ln, Ly = ly / ln, Lz = lz / ln;
  const k = amount * 2.6;
  for (let y = 0; y < H; y++) {
    const ym = y > 0 ? y - 1 : y, yp = y < H - 1 ? y + 1 : y;
    for (let x = 0; x < W; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < W - 1 ? x + 1 : x;
      const dhx = (h[y * W + xp] - h[y * W + xm]) * k;
      const dhy = (h[yp * W + x] - h[ym * W + x]) * k;
      const nl = Math.hypot(-dhx, -dhy, 1);
      const lam = (-dhx * Lx + -dhy * Ly + Lz) / nl - Lz;
      const g = 128 + Math.tanh(lam * 26) * 118;
      const o = (y * W + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(store.img, 0, 0);
}

// wobbled ink ruling; opacity pools where lines cross, breaks up along the run
function drawRuling(ctx, W, H, o) {
  if (o.ruling === "none" || o.opacity <= 0) return;
  const sp = Math.max(6, o.spacing);
  const major = Math.round(o.majorEvery);
  const seed = o.seed + 9001;
  const rgb = hexRgb(o.color);
  const seg = 4;
  const grid = o.ruling === "grid";

  if (grid && o.highlightCount > 0) {
    const hrgb = hexRgb(o.highlightColor);
    const rowsN = Math.ceil(H / sp), colsN = Math.ceil(W / sp);
    for (let m = 0; m < o.highlightCount; m++) {
      const r = 1 + Math.floor(hash2(m, 3, seed + 8123) * Math.max(1, rowsN - 2));
      const c = 1 + Math.floor(hash2(m, 9, seed + 4441) * Math.max(1, colsN - 2));
      const wCells = 1 + Math.floor(hash2(m, 11, seed + 77) * 3);
      const x0 = c * sp, y0 = r * sp;
      const j = (k) => (hash2(m, k, seed + 5) - 0.5) * 3;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0 + j(1), y0 + 1.5 + j(2));
      ctx.lineTo(x0 + wCells * sp - 1, y0 - 1);
      ctx.lineTo(x0 + wCells * sp + 1.5, y0 + sp - 1.5);
      ctx.lineTo(x0 - 1, y0 + sp + 1);
      ctx.closePath();
      ctx.fillStyle = `rgba(${hrgb[0]},${hrgb[1]},${hrgb[2]},${(0.16 + 0.18 * hash2(m, 21, seed + 13)).toFixed(3)})`;
      ctx.filter = "blur(1.2px)";
      ctx.fill();
      ctx.restore();
    }
  }

  const line = (index, horizontal) => {
    const len = horizontal ? W : H;
    const at = index * sp;
    const drift = (hash2(index, horizontal ? 1 : 2, seed) - 0.5) * 0.006;
    const isMajor = major > 1 && index % major === 0;
    const baseA = o.opacity * (isMajor ? 1 : 0.78);
    const baseW = isMajor ? 1.3 : 1;
    for (let s = 0; s < len; s += seg) {
      const t0 = s, t1 = Math.min(len, s + seg + 0.6);
      const n = fbm(t0 / len, index * 0.137, 5, 3, seed + (horizontal ? 0 : 733));
      const n2 = hash2(Math.round(t0 / seg), index, seed + 51);
      const cover = 0.35 + 0.9 * n;
      if (n2 > 0.965 - 0.12 * o.breakup) continue;
      let fade = 1 - 0.6 * o.breakup * (1 - Math.min(1, cover));
      if (grid) {
        const tc = (t0 + t1) / 2, k = Math.round(tc / sp);
        if (hash2(index + (horizontal ? 0 : 4096), k, seed + 1777) < 0.62) {
          const dd = Math.abs(tc - k * sp);
          const fall = 3.5 + 9 * hash2(k, index, seed + 2903);
          const amp = 0.35 + 0.85 * hash2(k, index, seed + 3313);
          fade *= 1 + amp * Math.exp(-(dd / fall) * (dd / fall));
        }
      }
      const bleed = n2 > 0.86 ? 1.9 : 1;
      const off = (p) => at + (fbm(p / len, index * 0.137 + 4.2, 3, 2, seed + 17) - 0.5) * 2 * o.wobble + (p - len / 2) * drift;
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(1, (baseA * fade) / bleed).toFixed(3)})`;
      ctx.lineWidth = baseW * bleed;
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(t0, off(t0)); ctx.lineTo(t1, off(t1)); }
      else { ctx.moveTo(off(t0), t0); ctx.lineTo(off(t1), t1); }
      ctx.stroke();
    }
  };

  for (let i = 1, rows = Math.ceil(H / sp) + 1; i < rows; i++) line(i, true);
  if (grid) for (let i = 1, cols = Math.ceil(W / sp) + 1; i < cols; i++) line(i, false);

  if (o.maskImg && o.maskImg.complete && o.maskImg.naturalWidth) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 0.3 * o.breakup + 0.08;
    ctx.fillStyle = ctx.createPattern(o.maskImg, "repeat");
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

const TONE_BLOBS = [
  [0.18, 0.22, 0.46, 0.38, "96,70,42", 0.075],
  [0.82, 0.12, 0.52, 0.44, "120,96,64", 0.055],
  [0.68, 0.78, 0.6, 0.5, "84,60,36", 0.07],
  [0.08, 0.84, 0.4, 0.34, "110,84,52", 0.06],
  [0.5, 0.5, 0.7, 0.6, "255,250,240", 0.1]
];

function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

// flatten every layer into one bitmap at an arbitrary size, for download
async function compose(p, W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = p.baseColor;
  ctx.fillRect(0, 0, W, H);

  TONE_BLOBS.forEach(([cx, cy, rw, rh, rgb, a]) => {
    const rad = Math.max(rw * W, rh * H) * 0.9;
    const g = ctx.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, rad);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });

  if (p.ruling !== "none") {
    const rc = document.createElement("canvas");
    rc.width = W; rc.height = H;
    const rctx = rc.getContext("2d");
    const mask = await loadImg(makeGrain({ size: 128, density: 0.5, sharpness: 1.1, clump: 0.4, octaves: 3, rgb: [255, 255, 255], seed: p.seed + 9004 }));
    drawRuling(rctx, W, H, {
      ruling: p.ruling, spacing: p.rulingSpacing, majorEvery: p.rulingMajorEvery,
      color: p.inkColor, opacity: p.inkOpacity, wobble: p.inkWobble, breakup: p.inkBreakup,
      seed: p.seed, maskImg: mask, highlightCount: p.highlightCount, highlightColor: p.highlightColor
    });
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(rc, 0, 0);
  }

  const draw = async (src, mode, alpha, tile) => {
    const img = await loadImg(src);
    if (!img) return;
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    if (tile) {
      const t = document.createElement("canvas");
      t.width = t.height = tile;
      const tc = t.getContext("2d");
      tc.drawImage(img, 0, 0, tile, tile);
      ctx.fillStyle = ctx.createPattern(t, "repeat");
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.drawImage(img, 0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  };

  await draw(makeFiber(p.seed + 7, Math.round(p.grainOctaves)), "multiply", Math.min(1, 0.5 * p.fiber), 760);

  const field = buildHeight({ seed: p.seed + 31, base: Math.round(p.crumpleScale), levels: Math.round(p.crumpleLevels) });
  const sc = document.createElement("canvas");
  shade(field, sc, p.lightAngle, p.crumple, {});
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = Math.min(1, p.crumpleOpacity);
  ctx.filter = p.crumpleSoftness > 0 ? `blur(${p.crumpleSoftness}px)` : "none";
  ctx.drawImage(sc, 0, 0, W, H);
  ctx.filter = "none";
  ctx.globalAlpha = 1;

  const tile = Math.round(Math.max(64, Math.min(512, p.grainScale)));
  const gopts = {
    size: tile, density: p.grainDensity, sharpness: p.grainSharpness,
    clump: p.grainClump, octaves: Math.round(p.grainOctaves), seed: p.seed
  };
  await draw(makeGrain({ ...gopts, rgb: [255, 252, 244] }), "screen", Math.min(1, 0.85 * p.grain), tile);
  await draw(makeGrain({ ...gopts, density: p.grainDensity * 0.7, sharpness: p.grainSharpness + 0.6, rgb: [58, 42, 26], seed: p.seed + 4409 }), "multiply", Math.min(1, p.grain * p.darkFleck), tile);

  ctx.globalCompositeOperation = "multiply";
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, "rgba(255,255,255,1)");
  vg.addColorStop(1, "rgba(72,50,28,0.14)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

window.PaperEngine = { hash2, vnoise, fbm, hexRgb, makeGrain, makeFiber, buildHeight, shade, drawRuling, TONE_BLOBS, compose };
})();

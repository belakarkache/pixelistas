export type ExtractMode = 'exact' | 'quantize';
export type ExtractSort = 'none' | 'hue' | 'lightness' | 'frequency';

export type ExtractOptions = {
  maxColors: number;
  mode: ExtractMode;
  ignoreTransparent: boolean;
  sort: ExtractSort;
};

export type ExtractResult = {
  colors: string[];
  counts: number[];
  uniqueCount: number;
  mode: ExtractMode;
  fallback: boolean;
  sampled: boolean;
};

type RawImage = { data: Uint8ClampedArray; width: number; height: number };

const SAMPLE_LIMIT = 1 << 18;
const DIRECT_LIMIT = 4096;
const KMEANS_ITERATIONS = 6;
const MERGE_DISTANCE_SQ = 0.012 * 0.012;
const ACHROMATIC_CHROMA = 0.02;

type Histogram = { keys: Uint32Array; counts: Uint32Array; size: number };

type Points = { l: Float64Array; a: Float64Array; b: Float64Array; alpha: Float64Array; w: Float64Array; n: number };

type Cluster = { l: number; a: number; b: number; alpha: number; w: number; order: number };

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const clampMaxColors = (n: number) => Math.min(256, Math.max(2, Math.round(Number.isFinite(n) ? n : 2)));

function toOklab(r: number, g: number, b: number, out: Float64Array) {
  const lr = LINEAR[r];
  const lg = LINEAR[g];
  const lb = LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function toSrgbByte(linear: number) {
  const c = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.max(0, linear) ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

function oklabToPacked(L: number, A: number, B: number, alpha: number) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = toSrgbByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = toSrgbByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = toSrgbByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const a = Math.min(255, Math.max(0, Math.round(alpha * 255)));
  return a === 0 ? 0 : (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

function packedToHex(p: number) {
  const a = p >>> 24;
  const rgb = `#${hex2(p & 255)}${hex2((p >>> 8) & 255)}${hex2((p >>> 16) & 255)}`;
  return a === 255 ? rgb : `${rgb}${hex2(a)}`;
}

function hashOf(key: number, mask: number) {
  return Math.imul(key ^ (key >>> 15), 0x2c1b3c6d) >>> 0 & mask;
}

function createHistogram(capacity: number): Histogram {
  let size = 1024;
  while (size < capacity * 2) size <<= 1;
  return { keys: new Uint32Array(size), counts: new Uint32Array(size), size: 0 };
}

function grow(h: Histogram) {
  const { keys, counts } = h;
  const next = keys.length << 1;
  const mask = next - 1;
  const nk = new Uint32Array(next);
  const nc = new Uint32Array(next);
  for (let i = 0; i < keys.length; i++) {
    if (!counts[i]) continue;
    let j = hashOf(keys[i], mask);
    while (nc[j]) j = (j + 1) & mask;
    nk[j] = keys[i];
    nc[j] = counts[i];
  }
  h.keys = nk;
  h.counts = nc;
}

function buildHistogram(img: RawImage, ignoreTransparent: boolean, step: number) {
  const pixels = new Uint32Array(img.data.buffer, img.data.byteOffset, img.data.byteLength >>> 2);
  const h = createHistogram(4096);
  const order: number[] = [];
  let mask = h.keys.length - 1;
  for (let y = 0; y < img.height; y += step) {
    const row = y * img.width;
    for (let x = 0; x < img.width; x += step) {
      let p = pixels[row + x];
      if (!(p >>> 24)) {
        if (ignoreTransparent) continue;
        p = 0;
      }
      let j = hashOf(p, mask);
      while (h.counts[j] && h.keys[j] !== p) j = (j + 1) & mask;
      if (h.counts[j]) {
        h.counts[j]++;
        continue;
      }
      h.keys[j] = p;
      h.counts[j] = 1;
      order.push(p);
      if (++h.size * 2 > h.keys.length) {
        grow(h);
        mask = h.keys.length - 1;
      }
    }
  }
  const counts = new Float64Array(order.length);
  for (let i = 0; i < order.length; i++) {
    let j = hashOf(order[i], mask);
    while (h.keys[j] !== order[i]) j = (j + 1) & mask;
    counts[i] = h.counts[j];
  }
  return { colors: Uint32Array.from(order), counts };
}

function createPoints(n: number): Points {
  return { l: new Float64Array(n), a: new Float64Array(n), b: new Float64Array(n), alpha: new Float64Array(n), w: new Float64Array(n), n };
}

function pointsFromColors(colors: Uint32Array, counts: Float64Array): Points {
  const lab = new Float64Array(3);
  if (colors.length <= DIRECT_LIMIT) {
    const pts = createPoints(colors.length);
    for (let i = 0; i < colors.length; i++) {
      const p = colors[i];
      toOklab(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, lab);
      pts.l[i] = lab[0];
      pts.a[i] = lab[1];
      pts.b[i] = lab[2];
      pts.alpha[i] = (p >>> 24) / 255;
      pts.w[i] = counts[i];
    }
    return pts;
  }
  const bins = new Map<number, number>();
  const acc: number[] = [];
  for (let i = 0; i < colors.length; i++) {
    const p = colors[i];
    const key = ((p & 255) >>> 3) | ((((p >>> 8) & 255) >>> 3) << 5) | ((((p >>> 16) & 255) >>> 3) << 10) | ((p >>> 29) << 15);
    let slot = bins.get(key);
    if (slot === undefined) {
      slot = acc.length;
      bins.set(key, slot);
      acc.push(0, 0, 0, 0, 0);
    }
    const w = counts[i];
    toOklab(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, lab);
    acc[slot] += lab[0] * w;
    acc[slot + 1] += lab[1] * w;
    acc[slot + 2] += lab[2] * w;
    acc[slot + 3] += ((p >>> 24) / 255) * w;
    acc[slot + 4] += w;
  }
  const pts = createPoints(acc.length / 5);
  for (let i = 0, s = 0; i < pts.n; i++, s += 5) {
    const w = acc[s + 4];
    pts.l[i] = acc[s] / w;
    pts.a[i] = acc[s + 1] / w;
    pts.b[i] = acc[s + 2] / w;
    pts.alpha[i] = acc[s + 3] / w;
    pts.w[i] = w;
  }
  return pts;
}

type Box = { start: number; end: number; score: number; axis: 0 | 1 | 2 | 3 };

function axisOf(pts: Points, axis: number) {
  return axis === 0 ? pts.l : axis === 1 ? pts.a : axis === 2 ? pts.b : pts.alpha;
}

function measureBox(pts: Points, idx: Uint32Array, start: number, end: number): Box {
  const arrays = [pts.l, pts.a, pts.b, pts.alpha];
  let w = 0;
  const sum = [0, 0, 0, 0];
  const sq = [0, 0, 0, 0];
  for (let i = start; i < end; i++) {
    const k = idx[i];
    const wk = pts.w[k];
    w += wk;
    for (let d = 0; d < 4; d++) {
      const v = arrays[d][k];
      sum[d] += v * wk;
      sq[d] += v * v * wk;
    }
  }
  let axis: Box['axis'] = 0;
  let best = -1;
  let score = 0;
  for (let d = 0; d < 4; d++) {
    const variance = Math.max(0, sq[d] - (sum[d] * sum[d]) / w);
    score += variance;
    if (variance > best) {
      best = variance;
      axis = d as Box['axis'];
    }
  }
  return { start, end, score: end - start > 1 ? score : -1, axis };
}

function medianCut(pts: Points, k: number): Cluster[] {
  const idx = new Uint32Array(pts.n);
  for (let i = 0; i < pts.n; i++) idx[i] = i;
  const boxes: Box[] = [measureBox(pts, idx, 0, pts.n)];
  while (boxes.length < k) {
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].score > 0 && (pick < 0 || boxes[i].score > boxes[pick].score)) pick = i;
    if (pick < 0) break;
    const box = boxes[pick];
    const values = axisOf(pts, box.axis);
    const slice = Array.from(idx.subarray(box.start, box.end)).sort((x, y) => values[x] - values[y] || x - y);
    idx.set(slice, box.start);
    let total = 0;
    for (const k2 of slice) total += pts.w[k2];
    let acc = 0;
    let cut = box.start + 1;
    for (let i = 0; i < slice.length - 1; i++) {
      acc += pts.w[slice[i]];
      cut = box.start + i + 1;
      if (acc * 2 >= total) break;
    }
    boxes.splice(pick, 1, measureBox(pts, idx, box.start, cut), measureBox(pts, idx, cut, box.end));
  }
  return boxes.map((box, order) => {
    const c: Cluster = { l: 0, a: 0, b: 0, alpha: 0, w: 0, order };
    for (let i = box.start; i < box.end; i++) {
      const p = idx[i];
      const w = pts.w[p];
      c.l += pts.l[p] * w;
      c.a += pts.a[p] * w;
      c.b += pts.b[p] * w;
      c.alpha += pts.alpha[p] * w;
      c.w += w;
    }
    c.l /= c.w;
    c.a /= c.w;
    c.b /= c.w;
    c.alpha /= c.w;
    return c;
  });
}

function refine(pts: Points, clusters: Cluster[]): Cluster[] {
  let current = clusters;
  const assign = new Int32Array(pts.n).fill(-1);
  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    const sorted = current.map((_, i) => i).sort((x, y) => current[x].l - current[y].l || x - y);
    const ls = Float64Array.from(sorted, (i) => current[i].l);
    let changed = 0;
    const sums = current.map(() => [0, 0, 0, 0, 0]);
    for (let p = 0; p < pts.n; p++) {
      const pl = pts.l[p];
      const pa = pts.a[p];
      const pb = pts.b[p];
      const pal = pts.alpha[p];
      let lo = 0;
      let hi = ls.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ls[mid] < pl) lo = mid + 1;
        else hi = mid;
      }
      let best = -1;
      let bestD = Infinity;
      for (let up = lo, down = lo - 1; up < ls.length || down >= 0; ) {
        const du = up < ls.length ? ls[up] - pl : Infinity;
        const dd = down >= 0 ? pl - ls[down] : Infinity;
        const near = du <= dd ? up++ : down--;
        const dl = Math.min(du, dd);
        if (dl * dl >= bestD) break;
        const ci = sorted[near];
        const c = current[ci];
        const x = c.l - pl;
        const y = c.a - pa;
        const z = c.b - pb;
        const q = c.alpha - pal;
        const d = x * x + y * y + z * z + q * q;
        if (d < bestD || (d === bestD && ci < best)) {
          bestD = d;
          best = ci;
        }
      }
      if (assign[p] !== best) {
        assign[p] = best;
        changed++;
      }
      const s = sums[best];
      const w = pts.w[p];
      s[0] += pl * w;
      s[1] += pa * w;
      s[2] += pb * w;
      s[3] += pal * w;
      s[4] += w;
    }
    const next: Cluster[] = [];
    for (let i = 0; i < current.length; i++) {
      const [l, a, b, alpha, w] = sums[i];
      if (w > 0) next.push({ l: l / w, a: a / w, b: b / w, alpha: alpha / w, w, order: current[i].order });
    }
    if (next.length !== current.length) assign.fill(-1);
    current = next;
    if (!changed) break;
  }
  return current;
}

function mergeClose(clusters: Cluster[]): Cluster[] {
  const byWeight = [...clusters].sort((x, y) => y.w - x.w || x.order - y.order);
  const kept: Cluster[] = [];
  for (const c of byWeight) {
    const target = kept.find((k) => {
      const x = k.l - c.l;
      const y = k.a - c.a;
      const z = k.b - c.b;
      const q = k.alpha - c.alpha;
      return x * x + y * y + z * z + q * q < MERGE_DISTANCE_SQ;
    });
    if (!target) {
      kept.push({ ...c });
      continue;
    }
    const w = target.w + c.w;
    target.l = (target.l * target.w + c.l * c.w) / w;
    target.a = (target.a * target.w + c.a * c.w) / w;
    target.b = (target.b * target.w + c.b * c.w) / w;
    target.alpha = (target.alpha * target.w + c.alpha * c.w) / w;
    target.order = Math.min(target.order, c.order);
    target.w = w;
  }
  return kept.sort((x, y) => x.order - y.order);
}

function quantize(colors: Uint32Array, counts: Float64Array, k: number) {
  const pts = pointsFromColors(colors, counts);
  const clusters = mergeClose(refine(pts, medianCut(pts, k)));
  const packed: number[] = [];
  const weights: number[] = [];
  const seen = new Map<number, number>();
  for (const c of clusters) {
    const p = oklabToPacked(c.l, c.a, c.b, c.alpha);
    const at = seen.get(p);
    if (at !== undefined) {
      weights[at] += c.w;
      continue;
    }
    seen.set(p, packed.length);
    packed.push(p);
    weights.push(c.w);
  }
  return { colors: Uint32Array.from(packed), counts: Float64Array.from(weights) };
}

function quantizeKeepingTransparent(colors: Uint32Array, counts: Float64Array, k: number) {
  const at = colors.indexOf(0);
  if (at < 0) return quantize(colors, counts, k);
  const rest = quantize(
    Uint32Array.from(colors.filter((_, i) => i !== at)),
    Float64Array.from(counts.filter((_, i) => i !== at)),
    k - 1,
  );
  const out = [0];
  const weights = [counts[at]];
  rest.colors.forEach((p, i) => {
    if (p) {
      out.push(p);
      weights.push(rest.counts[i]);
    } else weights[0] += rest.counts[i];
  });
  return { colors: Uint32Array.from(out), counts: Float64Array.from(weights) };
}

function sortIndices(colors: Uint32Array, counts: Float64Array, sort: ExtractSort): number[] {
  const order = Array.from(colors, (_, i) => i);
  if (sort === 'none') return order;
  if (sort === 'frequency') return order.sort((x, y) => counts[y] - counts[x] || x - y);
  const lab = new Float64Array(3);
  const keys = Array.from(colors, (p) => {
    toOklab(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, lab);
    const chroma = Math.hypot(lab[1], lab[2]);
    const hue = (Math.atan2(lab[2], lab[1]) + 2 * Math.PI) % (2 * Math.PI);
    return { l: lab[0], gray: chroma < ACHROMATIC_CHROMA, hue };
  });
  if (sort === 'lightness') return order.sort((x, y) => keys[x].l - keys[y].l || x - y);
  return order.sort((x, y) => {
    const a = keys[x];
    const b = keys[y];
    if (a.gray !== b.gray) return a.gray ? -1 : 1;
    if (!a.gray && Math.abs(a.hue - b.hue) > 1e-6) return a.hue - b.hue;
    return a.l - b.l || x - y;
  });
}

export function extractPaletteSync(img: RawImage, opts: ExtractOptions): ExtractResult {
  const maxColors = clampMaxColors(opts.maxColors);
  const total = img.width * img.height;
  const exact = opts.mode === 'exact';
  const step = exact || total <= SAMPLE_LIMIT ? 1 : Math.ceil(Math.sqrt(total / SAMPLE_LIMIT));
  const hist = buildHistogram(img, opts.ignoreTransparent, step);
  const uniqueCount = hist.colors.length;
  const fallback = exact && uniqueCount > maxColors;
  const result = uniqueCount > maxColors ? quantizeKeepingTransparent(hist.colors, hist.counts, maxColors) : hist;
  const order = sortIndices(result.colors, result.counts, opts.sort);
  return {
    colors: order.map((i) => packedToHex(result.colors[i])),
    counts: order.map((i) => Math.round(result.counts[i])),
    uniqueCount,
    mode: uniqueCount > maxColors ? 'quantize' : 'exact',
    fallback,
    sampled: step > 1,
  };
}

import { hexAlpha, withAlpha } from './colorUtils';

type Lab = { l: number; a: number; b: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const channel = (hex: string, i: number) => toLinear(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255);

function hexToOklab(hex: string): Lab {
  const r = channel(hex, 0);
  const g = channel(hex, 1);
  const b = channel(hex, 2);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

const toByte = (v: number) =>
  Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255)
    .toString(16)
    .padStart(2, '0');

function oklabToHex({ l, a, b }: Lab, alpha = 255): string {
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  return withAlpha(`#${toByte(r)}${toByte(g)}${toByte(bl)}`, alpha);
}

export function ramp(from: string, to: string, count: number): string[] {
  const a = hexToOklab(from);
  const b = hexToOklab(to);
  const aa = hexAlpha(from);
  const ba = hexAlpha(to);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    out.push(oklabToHex({ l: a.l + (b.l - a.l) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t }, Math.round(aa + (ba - aa) * t)));
  }
  return out;
}

type SortKey = 'hue' | 'lightness' | 'saturation';

const GRAY = 0.02;

function metrics(hex: string) {
  const { l, a, b } = hexToOklab(hex);
  const chroma = Math.hypot(a, b);
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, chroma, hue };
}

export function sortColors(colors: readonly string[], key: SortKey): string[] {
  const keyed = colors.map((hex) => ({ hex, ...metrics(hex) }));
  const compare = {
    lightness: (x: (typeof keyed)[number], y: (typeof keyed)[number]) => x.l - y.l,
    saturation: (x: (typeof keyed)[number], y: (typeof keyed)[number]) => x.chroma - y.chroma || x.l - y.l,
    hue: (x: (typeof keyed)[number], y: (typeof keyed)[number]) => {
      const xg = x.chroma < GRAY;
      const yg = y.chroma < GRAY;
      if (xg !== yg) return xg ? -1 : 1;
      return xg ? x.l - y.l : x.hue - y.hue || x.l - y.l;
    },
  }[key];
  return keyed.sort(compare).map((c) => c.hex);
}

export function dedupe(colors: readonly string[]): string[] {
  return [...new Set(colors)];
}

const HEX_TOKEN = /#?\b([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

export function parseHexText(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(HEX_TOKEN)) {
    const raw = match[1].toLowerCase();
    out.push(raw.length === 3 ? `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : `#${raw}`);
  }
  return out;
}

export function moveItems<T>(list: readonly T[], moved: ReadonlySet<number>, target: number): T[] {
  const rest = list.filter((_, i) => !moved.has(i));
  const first = Math.min(...moved);
  let insertAt = 0;
  for (let i = 0; i < list.length; i++) {
    if (moved.has(i)) continue;
    if (i < target || (i === target && target > first)) insertAt++;
  }
  const block = list.filter((_, i) => moved.has(i));
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

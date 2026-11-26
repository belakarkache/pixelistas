export type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

export const hexAlpha = (hex: string) => (hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255);

export const withAlpha = (hex: string, alpha: number) => (alpha >= 255 ? hex.slice(0, 7) : `${hex.slice(0, 7)}${alpha.toString(16).padStart(2, '0')}`);

export const checkerOver = (color: string) => `linear-gradient(${color}, ${color}), var(--checker)`;

export function paletteStrip(colors: readonly string[]): string {
  if (!colors.length) return 'none';
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${(i * step).toFixed(3)}% ${((i + 1) * step).toFixed(3)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')}), var(--checker)`;
}

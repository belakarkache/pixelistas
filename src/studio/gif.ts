type GifFrame = { pixels: Uint8ClampedArray; delay: number };

class ByteWriter {
  bytes: number[] = [];
  byte(v: number) {
    this.bytes.push(v & 255);
  }
  word(v: number) {
    this.byte(v);
    this.byte(v >> 8);
  }
  text(s: string) {
    for (const c of s) this.byte(c.charCodeAt(0));
  }
  all(arr: ArrayLike<number>) {
    for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i]);
  }
}

function buildPalette(frames: GifFrame[]): { colors: number[]; lookup: Map<number, number> } {
  const counts = new Map<number, number>();
  for (const f of frames) {
    const p = f.pixels;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 128) continue;
      const rgb = (p[i] << 16) | (p[i + 1] << 8) | p[i + 2];
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([rgb]) => rgb);
  const colors = sorted.slice(0, 255);
  const lookup = new Map<number, number>();
  colors.forEach((rgb, i) => lookup.set(rgb, i + 1));
  for (const rgb of sorted.slice(255)) {
    let best = 0;
    let bestDist = Infinity;
    colors.forEach((c, i) => {
      const dr = ((c >> 16) & 255) - ((rgb >> 16) & 255);
      const dg = ((c >> 8) & 255) - ((rgb >> 8) & 255);
      const db = (c & 255) - (rgb & 255);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i + 1;
      }
    });
    lookup.set(rgb, best);
  }
  return { colors, lookup };
}

function lzw(indices: Uint8Array, minCodeSize: number, out: ByteWriter) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map<number, number>();
  const data: number[] = [];
  let cur = 0;
  let bits = 0;
  const write = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      data.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  write(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    write(prefix);
    if (next === 4096) {
      write(clear);
      dict.clear();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  write(prefix);
  write(eoi);
  if (bits > 0) data.push(cur & 255);
  out.byte(minCodeSize);
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.byte(chunk.length);
    out.all(chunk);
  }
  out.byte(0);
}

export function encodeGif(width: number, height: number, frames: GifFrame[]): Blob {
  const { colors, lookup } = buildPalette(frames);
  let bitsPerColor = 1;
  while (1 << bitsPerColor < colors.length + 1) bitsPerColor++;
  const tableSize = 1 << bitsPerColor;
  const w = new ByteWriter();
  w.text('GIF89a');
  w.word(width);
  w.word(height);
  w.byte(0xf0 | (bitsPerColor - 1));
  w.byte(0);
  w.byte(0);
  for (let i = 0; i < tableSize; i++) {
    const c = i === 0 ? 0 : (colors[i - 1] ?? 0);
    w.byte(c >> 16);
    w.byte(c >> 8);
    w.byte(c);
  }
  if (frames.length > 1) {
    w.byte(0x21);
    w.byte(0xff);
    w.byte(11);
    w.text('NETSCAPE2.0');
    w.byte(3);
    w.byte(1);
    w.word(0);
    w.byte(0);
  }
  const minCodeSize = Math.max(2, bitsPerColor);
  for (const f of frames) {
    w.byte(0x21);
    w.byte(0xf9);
    w.byte(4);
    w.byte(0x09);
    w.word(Math.max(2, Math.round(f.delay / 10)));
    w.byte(0);
    w.byte(0);
    w.byte(0x2c);
    w.word(0);
    w.word(0);
    w.word(width);
    w.word(height);
    w.byte(0);
    const p = f.pixels;
    const indices = new Uint8Array(width * height);
    for (let i = 0, j = 0; j < indices.length; i += 4, j++) {
      indices[j] = p[i + 3] < 128 ? 0 : (lookup.get((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]) ?? 0);
    }
    lzw(indices, minCodeSize, w);
  }
  w.byte(0x3b);
  return new Blob([new Uint8Array(w.bytes)], { type: 'image/gif' });
}

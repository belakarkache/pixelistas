const SLIME_COLORS: Record<string, string> = {
  o: '#2b2340',
  b: 'var(--accent)',
  l: '#c9bdff',
  e: '#ffffff',
  k: '#2b2340',
  s: '#00000022',
};

const SLIME_FRAMES = [
  [
    '............',
    '............',
    '....oooo....',
    '...obbbbo...',
    '..oblbbbbo..',
    '..obbbbbbo..',
    '.obbebbebbo.',
    '.obbkbbkbbo.',
    '.obbbbbbbbo.',
    '.obbbbbbbbo.',
    '..oooooooo..',
    '...ssssss...',
  ],
  [
    '............',
    '............',
    '............',
    '....oooo....',
    '..oobbbboo..',
    '.oblbbbbbbo.',
    '.obbebbebbo.',
    '.obbkbbkbbo.',
    'obbbbbbbbbbo',
    'obbbbbbbbbbo',
    '.oooooooooo.',
    '..ssssssss..',
  ],
];

export const SLIME_PIXELS = SLIME_FRAMES.map((rows) =>
  rows.flatMap((row, y) =>
    [...row].flatMap((c, x) => (c === '.' ? [] : [{ x, y, fill: SLIME_COLORS[c] }])),
  ),
);

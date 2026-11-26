import { BrandMark } from './Brand';
import { Icon } from './Icon';
import { SLIME_PIXELS as PIXELS } from './slime';
import { useT } from './i18n';

const TOOLS = ['pencil', 'eraser', 'fill', 'picker', 'line', 'rect', 'select', 'hand'];

const SWATCHES = ['#2b2340', '#4a3f6b', 'var(--accent)', '#c9bdff', '#ffffff', '#f4cc75', '#e58a5c', '#d9435a', '#8fc6a2', '#3fae78', '#5fa8d9', '#9aa0b4'];

const LAYERS = [
  { n: 1, frame: 0 },
  { n: 2, frame: 1 },
];

function Sprite({ frame, className }: { frame: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {PIXELS[frame].map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width="1" height="1" fill={p.fill} />
      ))}
    </svg>
  );
}

export function HeroArt() {
  const t = useT();
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="hero-window">
        <div className="hero-topbar">
          <BrandMark />
          <span className="hero-name">slime</span>
          <span className="hero-saved">
            <i />
            {t('Saved')}
          </span>
          <span className="hero-top-icons">
            <Icon name="undo" size={12} />
            <Icon name="redo" size={12} />
          </span>
          <span className="hero-export">
            <Icon name="download" size={11} />
            {t('Export')}
          </span>
        </div>

        <div className="hero-workbench">
          <div className="hero-rail">
            {TOOLS.map((tool, i) => (
              <span key={tool} className={`hero-tool ${i === 0 ? 'selected' : ''} ${i === 4 || i === 6 ? 'sep' : ''}`}>
                <Icon name={tool} size={12} />
              </span>
            ))}
          </div>

          <div className="hero-center">
            <div className="hero-toolbar">
              <strong>{t('Pencil')}</strong>
              <span className="hero-chip">1px</span>
              <span className="hero-chip">
                <Icon name="mirror" size={10} />
              </span>
              <span className="hero-zoom">
                <Icon name="grid" size={10} />
                800%
              </span>
            </div>
            <div className="hero-stage">
              <div className="hero-canvas">
                <Sprite frame={0} className="hero-sprite f0" />
                <Sprite frame={1} className="hero-sprite f1" />
                <span className="hero-cursor" />
              </div>
            </div>
            <div className="hero-timeline">
              <span className="hero-play">
                <Icon name="play" size={9} />
              </span>
              <div className="hero-frame f0">
                <Sprite frame={0} />
                <b>1</b>
              </div>
              <div className="hero-frame f1">
                <Sprite frame={1} />
                <b>2</b>
              </div>
              <span className="hero-add">
                <Icon name="plus" size={10} />
              </span>
              <span className="hero-fps">2 fps</span>
            </div>
          </div>

          <div className="hero-inspector">
            <div className="hero-colors">
              <span className="hero-primary" />
              <span className="hero-secondary" />
              <em>#7257E8</em>
            </div>
            <div className="hero-label">{t('Palette')}</div>
            <div className="hero-swatches">
              {SWATCHES.map((c, i) => (
                <i key={c} className={i === 2 ? 'primary' : undefined} style={{ background: c }} />
              ))}
            </div>
            <div className="hero-label">{t('Layers')}</div>
            {LAYERS.map((l, i) => (
              <div key={l.n} className={`hero-layer ${i === 1 ? 'selected' : ''}`}>
                <Icon name="eye" size={10} />
                <span className="hero-layer-thumb">
                  <Sprite frame={l.frame} />
                </span>
                {t('Layer {n}', { n: l.n })}
              </div>
            ))}
          </div>
        </div>

        <div className="hero-statusbar">
          <span>X 5 Y 6</span>
          <span>{t('Layer {l} · Frame {f}/{total} · {zoom}', { l: 2, f: 1, total: 2, zoom: '800%' })}</span>
        </div>
      </div>
    </div>
  );
}

import { SLIME_PIXELS } from './slime';

export function BrandMark({ withName }: { withName?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark">
        {SLIME_PIXELS.map((pixels, frame) => (
          <svg key={frame} className={`brand-frame f${frame}`} viewBox="0 2 12 10" shapeRendering="crispEdges" aria-hidden="true">
            {pixels.map((p) => (
              <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
            ))}
          </svg>
        ))}
      </span>
      {withName && (
        <span className="brand-name">
          pixel<span>istas</span>
        </span>
      )}
    </span>
  );
}

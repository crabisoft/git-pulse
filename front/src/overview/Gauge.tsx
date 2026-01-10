import { DORA_TIERS, type DoraMetric, type DoraTier } from '@repo/shared';
import { gaugeAngle } from './gauge';

const CX = 60;
const CY = 56;
const R = 46;
const BAND = 45;

/** A point on the arc, in the SVG's own coordinates. */
function pointAt(degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [CX + R * Math.cos(radians), CY - R * Math.sin(radians)];
}

/**
 * A metric read as a position rather than as a number.
 *
 * The four DORA bands are drawn behind the marker, the occupied one saturated
 * and the rest held back. You can tell where you stand without knowing the
 * thresholds by heart, and crossing from one band into the next becomes a
 * visible event instead of a figure that moved a little.
 *
 * Decorative on purpose: the value and the tier are written beside it in text,
 * so nothing here is the only place a fact appears.
 */
export function Gauge({ metric, tierValue, tier }: { metric: DoraMetric; tierValue: number; tier: DoraTier }) {
  const angle = gaugeAngle(metric, tierValue);
  const [mx, my] = pointAt(angle ?? 0);

  return (
    <svg className="gauge" width={120} height={66} viewBox="0 0 120 66" aria-hidden="true">
      {DORA_TIERS.map((band, i) => {
        // Worst band on the left: the first tier starts at 180° and each one
        // takes the next 45° towards the right-hand end.
        const [x1, y1] = pointAt(180 - i * BAND);
        const [x2, y2] = pointAt(180 - (i + 1) * BAND);
        return (
          <path
            key={band}
            className={`gauge-band tier-${band}${band === tier ? ' is-active' : ''}`}
            d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`}
            fill="none"
          />
        );
      })}
      {angle !== null && (
        <>
          {/* Ringed in the surface colour so the marker stays findable wherever
              it lands on the band underneath it. */}
          <circle className="gauge-marker-ring" cx={mx} cy={my} r={6.5} />
          <circle className={`gauge-marker tier-${tier}`} cx={mx} cy={my} r={4} />
        </>
      )}
    </svg>
  );
}

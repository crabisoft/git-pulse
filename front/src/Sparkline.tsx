/**
 * A trend at the size of a word.
 *
 * Filled under the line and with its last point called out: at 84 pixels a
 * bare polyline reads as texture, and the point the row is actually about —
 * the current value — is the one that has to be findable.
 *
 * Decorative by construction: the figure it illustrates is beside it in text,
 * so the shape carries no information a reader would be missing without it.
 */
export function Sparkline({
  values,
  tone = 'neutral',
  width = 84,
  height = 22,
}: {
  values: number[];
  /** Whether the movement is good news. Neutral when nothing says. */
  tone?: 'good' | 'bad' | 'neutral';
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="spark-empty">—</span>;

  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <svg
      className={`spark tone-${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <polygon className="spark-area" points={`0,${height} ${points} ${width},${height}`} />
      <polyline className="spark-line" points={points} fill="none" />
      <circle className="spark-end" cx={width} cy={y(values[values.length - 1])} r="2" />
    </svg>
  );
}

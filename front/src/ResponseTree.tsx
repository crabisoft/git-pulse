import { useTranslation } from 'react-i18next';

/**
 * The parsed response, as something to click through.
 *
 * The reason it exists: the path language is written by a tenant of a hosted
 * install, not by whoever wrote the rule engine. Nobody should have to learn
 * `components[name=back].version` to read a version out of their own endpoint —
 * they should recognise the value on screen and click it. What the syntax has to
 * be is *generatable*, not powerful, which is the whole argument for a small
 * path language over JSONPath.
 *
 * The tree it walks is the one the backend resolves against — XML already
 * normalised — so a path picked here means the same thing there. Parsing the
 * body again in the browser would put a second normalisation on the other side
 * of the wire, and the paths would agree only until the two drifted.
 */
export function ResponseTree({
  value,
  onPick,
}: {
  value: unknown;
  /** Given the path of the clicked value, in the language the template uses. */
  onPick: (path: string) => void;
}) {
  return (
    <div className="response-tree">
      <Node value={value} path="" depth={0} addressable onPick={onPick} />
    </div>
  );
}

function Node({
  value,
  path,
  depth,
  addressable,
  label,
  onPick,
}: {
  value: unknown;
  path: string;
  depth: number;
  /** False once a step of this path cannot be spelled — see `spellable`. */
  addressable: boolean;
  /** How this node is named by its parent — a key, or an index. */
  label?: string;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();

  if (Array.isArray(value)) {
    // A lone element is stepped through by the resolver, so its path carries no
    // index — the same path then keeps working the day a second one appears,
    // which is exactly the XML trap the normalisation was there to close.
    const indexed = value.length > 1;
    return (
      <Branch label={label} depth={depth} count={value.length}>
        {value.map((child, i) => (
          <Node
            key={i}
            value={child}
            path={indexed ? `${path}[${i}]` : path}
            depth={depth + 1}
            addressable={addressable}
            label={indexed ? `[${i}]` : undefined}
            onPick={onPick}
          />
        ))}
      </Branch>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    return (
      <Branch label={label} depth={depth} count={entries.length}>
        {entries.map(([key, child]) => (
          <Node
            key={key}
            value={child}
            // `#text` is not a step: the resolver reads the text of an element
            // that carries attributes on its own, so the shorter path is both
            // what an author would write and what survives an attribute being
            // added to the element later.
            path={key === '#text' ? path : join(path, key)}
            depth={depth + 1}
            addressable={addressable && (key === '#text' || spellable(key))}
            label={key}
            onPick={onPick}
          />
        ))}
      </Branch>
    );
  }

  const text = value === null || value === undefined ? '' : String(value);
  const pickable = path !== '' && addressable;

  return (
    <div className="rt-leaf" style={indent(depth)}>
      {label && <span className="rt-key">{label}</span>}
      {pickable ? (
        <button
          type="button"
          className="rt-value"
          title={t('versionRules.tree.insert', { path })}
          onClick={() => onPick(path)}
        >
          {text}
        </button>
      ) : (
        // Shown and not offered, rather than offered and broken: the template
        // would be saved and read nothing, on a schedule, quietly.
        <span className="rt-value unpickable" title={t('versionRules.tree.unpickable')}>
          {text}
        </span>
      )}
    </div>
  );
}

/**
 * A node with children. Open by default, and collapsible rather than collapsed:
 * a version endpoint answers a small document, and the value being looked for
 * is as likely to be four levels down as one. The tree scrolls inside its own
 * box, so opening everything costs the dialog nothing.
 */
function Branch({
  label,
  depth,
  count,
  children,
}: {
  label?: string;
  depth: number;
  count: number;
  children: React.ReactNode;
}) {
  if (!label) return <>{children}</>;
  return (
    <details open className="rt-branch" style={indent(depth)}>
      <summary>
        <span className="rt-key">{label}</span>
        <span className="rt-count">{count}</span>
      </summary>
      {children}
    </details>
  );
}

/** Nesting drawn with padding rather than markup, so a leaf stays one row. */
function indent(depth: number): React.CSSProperties {
  return { paddingInlineStart: `${Math.min(depth, 8) * 12}px` };
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * Whether a key can be spelled as a step of the path language.
 *
 * A JSON key may hold anything, including the separators the language is made
 * of: `{"build.version": "1.4.2"}` is legal, and a path built from it would
 * parse as two steps that resolve to nothing. Rare, and worth detecting — the
 * alternative is a rule saved with a path that reads nothing, on a schedule,
 * with nobody watching.
 */
function spellable(key: string): boolean {
  return key !== '' && !/[.[\]=]/.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

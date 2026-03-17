import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataList, type Column } from './DataList';

/**
 * The design tokens, read out of the stylesheet rather than listed by hand.
 *
 * `styles.css` declares them and nothing else did — so the inventory existed
 * only as 1200 lines of CSS, and a contributor looking for "the border colour"
 * had to grep for it. This reads `:root` back out of the loaded stylesheet at
 * render time, which means it cannot go stale: a token added, renamed or
 * dropped shows up here on the next reload.
 *
 * Switch the toolbar to dark and the values change with it, because they are
 * resolved against the mode in effect.
 */
function tokens(): Array<{ name: string; value: string }> {
  const computed = getComputedStyle(document.documentElement);
  const names = new Set<string>();

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A stylesheet from another origin. Storybook's own, never ours.
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(':root')) continue;
      for (const property of Array.from(rule.style)) {
        if (property.startsWith('--')) names.add(property);
      }
    }
  }

  return [...names]
    .sort()
    .map((name) => ({ name, value: computed.getPropertyValue(name).trim() }));
}

/** A value worth showing as a colour rather than as text. */
function isColour(value: string): boolean {
  return /^(#|rgb|hsl|color\()/.test(value);
}

type Token = { name: string; value: string };

const COLUMNS: Array<Column<Token>> = [
  {
    key: 'swatch',
    role: 'aside',
    cell: (token) =>
      isColour(token.value) ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '1.6rem',
            height: '1.6rem',
            borderRadius: '4px',
            background: token.value,
            border: '1px solid var(--border)',
          }}
        />
      ) : null,
  },
  { key: 'name', header: 'Token', role: 'lead', cell: (token) => <code>{token.name}</code> },
  {
    key: 'value',
    header: 'Value',
    // One token is an inlined SVG data URI: shown whole, it is four lines of
    // base64 where every other row is six characters.
    cell: (token) => (
      <code className="muted" title={token.value}>
        {token.value.length > 60 ? `${token.value.slice(0, 60)}…` : token.value}
      </code>
    ),
  },
];

function Tokens() {
  const all = tokens();
  const groups = new Map<string, Array<{ name: string; value: string }>>();
  for (const token of all) {
    // `--accent-soft` and `--accent` belong together; the first segment is the
    // family, which is how they were named in the first place.
    const family = token.name.replace(/^--/, '').split('-')[0];
    const bucket = groups.get(family);
    if (bucket) bucket.push(token);
    else groups.set(family, [token]);
  }

  return (
    <div style={{ padding: '1rem', display: 'grid', gap: '1.5rem' }}>
      <p className="muted">
        {all.length} tokens, read from <code>styles.css</code> as the browser resolved them.
      </p>
      {[...groups].map(([family, items]) => (
        <section key={family}>
          <h3 style={{ marginBottom: '.5rem' }}>{family}</h3>
          {/* Through `DataList` rather than a table of its own: the layout
              contract leaves tables to the one component that also renders
              cards, and a reference page is no reason to be the exception. */}
          <DataList rows={items} columns={COLUMNS} rowKey={(token) => token.name} />
        </section>
      ))}
    </div>
  );
}

const meta = {
  title: 'Foundations/Design tokens',
  component: Tokens,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Tokens>;

export default meta;

export const All: StoryObj<typeof meta> = {};

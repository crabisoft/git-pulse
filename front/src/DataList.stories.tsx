import type { Meta, StoryObj } from '@storybook/react-vite';
import { DEPLOYMENTS } from '../e2e/fixtures';
import { DataList, type Column } from './DataList';
import { RefLink } from './RefLink';

/**
 * A set of records, as a table on a wide screen and as cards on a phone.
 *
 * The rows come from the fixtures the layout suite answers with — the same
 * long branch names, deliberately, since a row that fits because the data was
 * short proves nothing.
 *
 * **The card rendering is not switchable from here.** Which of the two is in
 * the document follows from a media query rather than from a container, so
 * narrow the browser (or the preview pane) to see it — and it is the layout
 * suite under `e2e/`, at 360px in a real engine, that asserts it holds.
 */
type Row = (typeof DEPLOYMENTS.deployments.items)[number];

const ROWS = DEPLOYMENTS.deployments.items;

const COLUMNS: Array<Column<Row>> = [
  {
    key: 'environment',
    header: 'Environment',
    role: 'lead',
    cell: (row) => row.environment,
  },
  {
    key: 'status',
    header: 'Status',
    role: 'aside',
    cell: (row) => (
      <span className={`pill ${row.status === 'failed' ? 'bad' : 'good'}`}>{row.status}</span>
    ),
  },
  { key: 'repo', header: 'Repository', cell: (row) => row.repo },
  {
    key: 'ref',
    header: 'Ref',
    cell: (row) => <RefLink name={row.ref} url={row.refUrl} />,
  },
  {
    key: 'attributes',
    header: 'Dimensions',
    role: 'full',
    cell: (row) => (
      <span className="pills">
        {Object.entries(row.attributes).map(([key, value]) => (
          <span className="pill" key={key}>
            {key}={value}
          </span>
        ))}
      </span>
    ),
  },
];

function List({ rows, expandable }: { rows: readonly Row[]; expandable?: boolean }) {
  return (
    <DataList
      rows={rows}
      columns={COLUMNS}
      rowKey={(row) => row.id}
      rowClass={(row) => (row.status === 'failed' ? 'row-bad' : undefined)}
      expanded={
        expandable
          ? (row) => <p className="muted">Deployed {new Date(row.createdAt).toUTCString()}</p>
          : undefined
      }
    />
  );
}

const meta = {
  title: 'Controls/DataList',
  component: List,
  args: { rows: ROWS },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof List>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ATable: Story = {};

/** A row that says it is remarkable — here, one that failed. */
export const WithOneRow: Story = { args: { rows: [ROWS[0]] } };

/**
 * Opened rows: a table gives the detail a row of its own spanning the columns,
 * a card puts it at the bottom of itself, which is where it already was.
 */
export const Expanded: Story = { args: { expandable: true } };

/**
 * Nothing at all. An empty set renders nothing rather than an empty table —
 * what "no rows" means belongs to the page, which says it in its own words.
 */
export const Empty: Story = { args: { rows: [] } };

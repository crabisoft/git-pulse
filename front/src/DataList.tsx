import { Fragment, type ReactNode } from 'react';
import { useNarrow } from './hooks';

/**
 * One column, described once and rendered twice.
 *
 * `role` is what the two renderings disagree about, and the only thing they do.
 * A table gives every column the same weight because they are side by side; a
 * card is read top to bottom, so something has to come first and something has
 * to be allowed to take the width. Left unset, a column is a labelled line.
 */
export interface Column<T> {
  key: string;
  /** Column header, and the key a card puts beside the value. */
  header?: ReactNode;
  cell: (row: T) => ReactNode;
  /**
   * - `lead`   — what identifies the record: it heads the card, unlabelled.
   * - `aside`  — sits beside the lead. A status, a badge; one line's worth.
   * - `full`   — takes the card's width with no key: pills, a row of actions.
   */
  role?: 'lead' | 'aside' | 'full';
  className?: string;
}

/**
 * A set of records, as a table on a wide screen and as cards on a phone.
 *
 * The two are genuinely different layouts rather than one scaled down: six
 * columns dragged sideways is not a list, it is a table somebody has to drag.
 * What makes that affordable is describing the columns once — a page that spelt
 * out both renderings would have two of every cell to keep in step, and they
 * would drift the first time a column was added.
 *
 * Only one of the two is ever in the document, which is what separates this
 * from rendering both and hiding one: every row would otherwise be there twice
 * for a screen reader, and twice for anybody searching the page.
 */
export function DataList<T>({
  rows,
  columns,
  rowKey,
  rowClass,
  expanded,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  rowKey: (row: T) => string;
  /** Class on the table row or the card — how a row says it is remarkable. */
  rowClass?: (row: T) => string | undefined;
  /**
   * What a row shows when it is opened, or nothing when it is closed. A table
   * puts it in a row of its own spanning the columns; a card puts it at the
   * bottom of itself, which is where it already was.
   */
  expanded?: (row: T) => ReactNode;
}) {
  const narrow = useNarrow();
  if (rows.length === 0) return null;

  if (!narrow) {
    return (
      // The scroll belongs to the wrapper, not to the table. A table made a
      // block to scroll keeps its box the full width while its rows shrink to
      // their content, which is how a list ended up hugging the left of a panel
      // twice its width.
      <div className="data-scroll">
        <table className="data">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.className}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const detail = expanded?.(row);
              return (
                <Fragment key={rowKey(row)}>
                  <tr className={rowClass?.(row)}>
                    {columns.map((column) => (
                      <td key={column.key} className={column.className}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {detail && (
                    <tr className="detail-row">
                      <td colSpan={columns.length}>{detail}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const lead = columns.filter((c) => c.role === 'lead');
  const aside = columns.filter((c) => c.role === 'aside');
  const rest = columns.filter((c) => c.role !== 'lead' && c.role !== 'aside');

  return (
    <ul className="card-list">
      {rows.map((row) => (
        <li key={rowKey(row)} className={`card${rowClass?.(row) ? ` ${rowClass(row)}` : ''}`}>
          {(lead.length > 0 || aside.length > 0) && (
            <div className="card-head">
              <span>{lead.map((c) => c.cell(row))}</span>
              <span>{aside.map((c) => c.cell(row))}</span>
            </div>
          )}
          {rest.map((column) => {
            const content = column.cell(row);
            // An empty cell earns no line: a card is read as a whole, so a key
            // with nothing beside it is a question the record does not answer.
            if (content === null || content === undefined || content === false) return null;
            return column.role === 'full' ? (
              <div key={column.key} className={column.className}>
                {content}
              </div>
            ) : (
              <div key={column.key} className="card-line">
                <span className="card-key">{column.header}</span>
                <span className={column.className}>{content}</span>
              </div>
            );
          })}
          {expanded?.(row)}
        </li>
      ))}
    </ul>
  );
}

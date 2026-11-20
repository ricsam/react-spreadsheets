import type {
  FormulaEngine,
  TableColumnFilter,
  TableColumnValue,
  TableDefinition,
  TableFilterConditionOperator,
  TableSortDirection
} from '@ricsam/formula-engine';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';

/** At most this many values are listed; search narrows longer lists. */
const MAX_LISTED_VALUES = 1000;
const MENU_WIDTH = 272;
const VIEWPORT_MARGIN = 8;

export type TableHeaderFilterState = {
  filtered: boolean;
  sort?: TableSortDirection;
};

/** A table column's filter and sort state, as its header button shows it. */
export const getTableHeaderFilterState = (
  table: TableDefinition,
  column: number
): TableHeaderFilterState => {
  const sortKey = table.sort?.[0];
  return {
    filtered: Boolean(table.filter?.columns.some((entry) => entry.column === column)),
    ...(sortKey?.column === column ? { sort: sortKey.direction } : {})
  };
};

const getColumnName = (table: TableDefinition, column: number): string =>
  Array.from(table.headers.values()).find((header) => header.index === column)?.name ??
  `Column ${column + 1}`;

const ChevronIcon = () => (
  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FunnelIcon = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <path d="M2.5 3h11l-4.2 5.2v4.3l-2.6 1.3V8.2z" fill="currentColor" />
  </svg>
);

const SortArrowIcon = ({ direction }: { direction: TableSortDirection }) => (
  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
    {direction === 'ascending' ? (
      <path d="M8 13V3M4.5 6.5L8 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M8 3v10M4.5 9.5L8 13l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    )}
  </svg>
);

/**
 * Stops pointer events at the button so the grid neither starts a selection
 * nor begins editing the header cell underneath it. The grid listens on the
 * cell element itself, so this has to happen natively, before React's
 * delegated handlers run.
 */
const keepPointerFromGrid = (element: HTMLButtonElement | null) => {
  if (!element) return;
  const stop = (event: Event) => event.stopPropagation();
  element.addEventListener('mousedown', stop);
  element.addEventListener('dblclick', stop);
  return () => {
    element.removeEventListener('mousedown', stop);
    element.removeEventListener('dblclick', stop);
  };
};

export function TableFilterButton({
  address,
  columnName,
  state,
  expanded,
  onOpen
}: {
  /** A1 address of the header cell, used to find the button for Alt+Down. */
  address: string;
  columnName: string;
  state: TableHeaderFilterState;
  expanded: boolean;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const description = [
    state.filtered ? 'filtered' : undefined,
    state.sort ? `sorted ${state.sort}` : undefined
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      type="button"
      ref={keepPointerFromGrid}
      className={cn('rsp-table-filter-button', {
        'rsp-table-filter-button-active': state.filtered || Boolean(state.sort)
      })}
      data-rsp-filter-button={address}
      data-filtered={state.filtered || undefined}
      data-sort={state.sort}
      aria-label={`Sort and filter ${columnName}${description ? ` (${description})` : ''}`}
      title={`Sort and filter ${columnName}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
    >
      {state.sort && <SortArrowIcon direction={state.sort} />}
      {state.filtered ? <FunnelIcon /> : !state.sort && <ChevronIcon />}
    </button>
  );
}

type ValueEntry = TableColumnValue & { key: string; label: string };

const entryKey = (entry: TableColumnValue): string =>
  entry.kind === 'blank'
    ? 'blank'
    : entry.kind === 'error'
      ? `e:${entry.error}`
      : `${typeof entry.value}:${String(entry.value).toLocaleLowerCase()}`;

const formatValue = (entry: TableColumnValue): string => {
  if (entry.kind === 'blank') return '(Blanks)';
  if (entry.kind === 'error') return entry.error;
  if (typeof entry.value === 'boolean') return entry.value ? 'TRUE' : 'FALSE';
  if (typeof entry.value === 'number') {
    return entry.value.toLocaleString('en-US', { maximumFractionDigits: 10 });
  }
  return entry.value;
};

const CONDITION_OPERATORS: { value: TableFilterConditionOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Does not equal' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'greaterThanOrEqual', label: 'Greater than or equal to' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'lessThanOrEqual', label: 'Less than or equal to' },
  { value: 'beginsWith', label: 'Begins with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' }
];

const TEXT_OPERATORS = new Set<TableFilterConditionOperator>([
  'beginsWith',
  'endsWith',
  'contains',
  'notContains'
]);

/** Text that reads as a number filters numbers; everything else filters text. */
const parseConditionValue = (
  operator: TableFilterConditionOperator,
  text: string
): string | number | boolean => {
  if (TEXT_OPERATORS.has(operator)) return text;
  const trimmed = text.trim();
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  return text;
};

export type TableFilterMenuProps = {
  engine: FormulaEngine;
  table: TableDefinition;
  column: number;
  /** The header's filter button, the menu's anchor. */
  anchor: HTMLElement;
  /** The positioned element the menu is rendered in. */
  container: HTMLElement;
  /** Close the menu; `restoreGridFocus` returns keyboard focus to the grid. */
  onClose: (restoreGridFocus: boolean) => void;
  onError?: (error: unknown) => void;
};

/**
 * Excel-style sort and filter menu for one table column: sort buttons, a
 * custom condition and the column's value list. Every change is a single
 * engine call, so it is one undo step and reaches every view of the table.
 */
export function TableFilterMenu({
  engine,
  table,
  column,
  anchor,
  container,
  onClose,
  onError
}: TableFilterMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const columnName = getColumnName(table, column);
  const tableRef = { workbookName: table.workbookName, tableName: table.name };
  const currentFilter = table.filter?.columns.find((entry) => entry.column === column)?.filter;
  const conditionFilter = currentFilter?.type === 'condition' ? currentFilter : undefined;

  const entries = useMemo<ValueEntry[]>(() => {
    try {
      return engine
        .getTableColumnValues({ ...tableRef, column })
        .map((entry) => ({ ...entry, key: entryKey(entry), label: formatValue(entry) }));
    } catch (error) {
      onError?.(error);
      return [];
    }
    // The list is a snapshot taken when the menu opens, like Excel's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const numeric = entries.some((entry) => entry.kind === 'value' && typeof entry.value === 'number') &&
    entries.every((entry) => entry.kind !== 'value' || typeof entry.value === 'number');

  const [checked, setChecked] = useState(
    () => new Set(entries.filter((entry) => entry.selected).map((entry) => entry.key))
  );
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [operator, setOperator] = useState<TableFilterConditionOperator>(
    conditionFilter?.conditions[0]?.operator ?? (numeric ? 'greaterThan' : 'contains')
  );
  const [conditionText, setConditionText] = useState(
    conditionFilter?.conditions[0] ? String(conditionFilter.conditions[0].value) : ''
  );
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>();

  const query = search.trim().toLocaleLowerCase();
  const matching = query
    ? entries.filter((entry) => entry.label.toLocaleLowerCase().includes(query))
    : entries;
  const listed = matching.slice(0, MAX_LISTED_VALUES);
  const allMatchingChecked = matching.length > 0 && matching.every((entry) => checked.has(entry.key));
  const someMatchingChecked = matching.some((entry) => checked.has(entry.key));

  // Position below the button, inside the container, compensating for any
  // CSS scale (zoom) applied to an ancestor.
  useLayoutEffect(() => {
    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const scaleX = container.offsetWidth ? containerRect.width / container.offsetWidth : 1;
    const scaleY = container.offsetHeight ? containerRect.height / container.offsetHeight : 1;
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const menuWidth = Math.min(MENU_WIDTH, Math.max(0, width - VIEWPORT_MARGIN * 2));
    let left = (anchorRect.right - containerRect.left) / scaleX - menuWidth;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, width - menuWidth - VIEWPORT_MARGIN));
    const below = (anchorRect.bottom - containerRect.top) / scaleY + 2;
    const above = (anchorRect.top - containerRect.top) / scaleY - 2;
    const spaceBelow = height - below - VIEWPORT_MARGIN;
    const openAbove = spaceBelow < 220 && above - VIEWPORT_MARGIN > spaceBelow;
    const maxHeight = Math.max(160, openAbove ? above - VIEWPORT_MARGIN : spaceBelow);
    const top = openAbove ? Math.max(VIEWPORT_MARGIN, above - maxHeight) : below;
    setPosition({ left, top, maxHeight });
  }, [anchor, container]);

  useEffect(() => {
    if (position) searchRef.current?.focus({ preventScroll: true });
  }, [position]);

  // Close on a press outside the menu (but not on its own button, which
  // toggles) and on Escape.
  useEffect(() => {
    const ownerDocument = container.ownerDocument;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose(false);
    };
    ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    return () => ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, container, onClose]);

  const run = useCallback(
    (action: () => void) => {
      try {
        action();
        onClose(true);
      } catch (error) {
        onError?.(error);
      }
    },
    [onClose, onError]
  );

  const sort = (direction: TableSortDirection) =>
    run(() => engine.sortTable({ ...tableRef, keys: [{ column, direction }] }));

  const clear = () =>
    run(() => engine.setTableColumnFilter({ ...tableRef, column, filter: undefined }));

  const applyCondition = () => {
    if (conditionText.trim() === '' && operator !== 'equals' && operator !== 'notEquals') return;
    run(() =>
      engine.setTableColumnFilter({
        ...tableRef,
        column,
        filter: {
          type: 'condition',
          conditions: [{ operator, value: parseConditionValue(operator, conditionText) }]
        }
      })
    );
  };

  const applyValues = () => {
    if (!dirty && !query) {
      onClose(true);
      return;
    }
    // With a search active, the filter keeps the checked values that match it.
    const chosen = (query ? matching : entries).filter((entry) => checked.has(entry.key));
    const showsEverything = chosen.length === entries.length;
    const filter: TableColumnFilter | undefined = showsEverything
      ? undefined
      : {
          type: 'values',
          values: chosen.flatMap((entry) => (entry.kind === 'value' ? [entry.value] : [])),
          ...(chosen.some((entry) => entry.kind === 'blank') ? { blanks: true } : {}),
          ...(chosen.some((entry) => entry.kind === 'error')
            ? {
                errors: chosen.flatMap((entry) => (entry.kind === 'error' ? [entry.error] : []))
              }
            : {})
        };
    run(() => engine.setTableColumnFilter({ ...tableRef, column, filter }));
  };

  const toggle = (key: string) => {
    setDirty(true);
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setDirty(true);
    setChecked((previous) => {
      const next = new Set(previous);
      for (const entry of matching) {
        if (allMatchingChecked) next.delete(entry.key);
        else next.add(entry.key);
      }
      return next;
    });
  };

  const sortDirection = table.sort?.[0]?.column === column ? table.sort[0].direction : undefined;
  const nothingChosen = !(query ? matching : entries).some((entry) => checked.has(entry.key));

  return (
    <div
      ref={menuRef}
      className="rsp-table-filter-menu"
      role="dialog"
      aria-label={`Sort and filter ${columnName}`}
      data-testid="table-filter-menu"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        maxHeight: position?.maxHeight,
        width: MENU_WIDTH,
        visibility: position ? 'visible' : 'hidden'
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div className="rsp-table-filter-title">{columnName}</div>
      <div className="rsp-table-filter-section">
        <button
          type="button"
          className="rsp-table-filter-action"
          aria-pressed={sortDirection === 'ascending'}
          onClick={() => sort('ascending')}
        >
          <SortArrowIcon direction="ascending" />
          {numeric ? 'Sort smallest to largest' : 'Sort A to Z'}
        </button>
        <button
          type="button"
          className="rsp-table-filter-action"
          aria-pressed={sortDirection === 'descending'}
          onClick={() => sort('descending')}
        >
          <SortArrowIcon direction="descending" />
          {numeric ? 'Sort largest to smallest' : 'Sort Z to A'}
        </button>
        <button
          type="button"
          className="rsp-table-filter-action"
          disabled={!currentFilter}
          onClick={clear}
        >
          <FunnelIcon />
          Clear filter from “{columnName}”
        </button>
      </div>
      <details className="rsp-table-filter-section rsp-table-filter-condition" open={Boolean(conditionFilter)}>
        <summary>Filter by condition</summary>
        <div className="rsp-table-filter-condition-row">
          <select
            aria-label="Condition"
            value={operator}
            onChange={(event) => setOperator(event.target.value as TableFilterConditionOperator)}
          >
            {CONDITION_OPERATORS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Condition value"
            value={conditionText}
            placeholder={numeric ? 'Number' : 'Text'}
            onChange={(event) => setConditionText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyCondition();
              }
            }}
          />
        </div>
        <button type="button" className="rsp-table-filter-button-secondary" onClick={applyCondition}>
          Apply condition
        </button>
      </details>
      <div className="rsp-table-filter-section rsp-table-filter-values">
        <input
          ref={searchRef}
          type="search"
          className="rsp-table-filter-search"
          aria-label={`Search values of ${columnName}`}
          placeholder="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyValues();
            }
          }}
        />
        <div className="rsp-table-filter-list" role="group" aria-label={`Values of ${columnName}`}>
          {matching.length > 0 && (
            <label className="rsp-table-filter-option rsp-table-filter-option-all">
              <input
                type="checkbox"
                checked={allMatchingChecked}
                ref={(input) => {
                  if (input) input.indeterminate = someMatchingChecked && !allMatchingChecked;
                }}
                onChange={toggleAll}
              />
              <span>{query ? '(Select all search results)' : '(Select all)'}</span>
            </label>
          )}
          {listed.map((entry) => (
            <label key={entry.key} className="rsp-table-filter-option">
              <input type="checkbox" checked={checked.has(entry.key)} onChange={() => toggle(entry.key)} />
              <span className="rsp-table-filter-option-label" title={entry.label}>
                {entry.label}
              </span>
              <span className="rsp-table-filter-option-count">{entry.count}</span>
            </label>
          ))}
          {matching.length === 0 && <div className="rsp-table-filter-empty">No matching values</div>}
          {matching.length > listed.length && (
            <div className="rsp-table-filter-empty">
              Showing {listed.length} of {matching.length} values. Search to narrow the list.
            </div>
          )}
        </div>
      </div>
      <div className="rsp-table-filter-footer">
        <button type="button" className="rsp-table-filter-button-secondary" onClick={() => onClose(true)}>
          Cancel
        </button>
        <button
          type="button"
          className="rsp-table-filter-button-primary"
          disabled={nothingChosen}
          onClick={applyValues}
        >
          OK
        </button>
      </div>
    </div>
  );
}

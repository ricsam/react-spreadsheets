import React, { useEffect, useId, useRef, useState } from 'react';

interface SheetNavigationProps {
  sheets: string[];
  activeSheet: string;
  workbookName: string;
  panelId?: string;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
  children?: React.ReactNode;
}

/** Workbook chrome only: never takes over the grid's keyboard events. */
export function SheetNavigation({
  sheets,
  activeSheet,
  workbookName,
  panelId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  children
}: SheetNavigationProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = sheets.includes(activeSheet) ? activeSheet : sheets[0];

  const focusTab = (sheet = selected) => {
    const tabs = root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[sheets.indexOf(sheet ?? '')]?.focus();
  };
  useEffect(() => {
    const tab = root.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const strip = tab?.parentElement;
    if (!tab || !strip) return;
    const bounds = strip.getBoundingClientRect();
    const target = tab.getBoundingClientRect();
    // Reveal within the strip only; never scroll the host page or editor pane.
    if (target.left < bounds.left) strip.scrollLeft -= bounds.left - target.left;
    else if (target.right > bounds.right) strip.scrollLeft += target.right - bounds.right;
  }, [activeSheet, sheets.join('\u0000')]);
  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  useEffect(() => {
    setMenuOpen(false);
    setRenaming(null);
    setError('');
  }, [workbookName]);
  useEffect(() => {
    if (renaming && !sheets.includes(renaming)) {
      setRenaming(null);
      setError('');
    }
  }, [renaming, sheets.join('\u0000')]);

  const run = (action: () => void) => {
    try {
      action();
      setError('');
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to update this sheet. Please try again.'
      );
      return false;
    }
  };
  const startRename = (sheet: string) => {
    setMenuOpen(false);
    setError('');
    setRenaming(sheet);
    setName(sheet);
  };
  const cancelRename = () => {
    setRenaming(null);
    setError('');
    focusTab();
  };
  const saveRename = (event: React.FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    const next = name.trim();
    if (!next) {
      setError('Enter a sheet name.');
      input.current?.focus();
      return;
    }
    if (
      sheets.some(
        (sheet) => sheet !== renaming && sheet.toLocaleLowerCase() === next.toLocaleLowerCase()
      )
    ) {
      setError('A sheet with this name already exists. Choose a different name.');
      input.current?.focus();
      return;
    }
    if (
      run(() => {
        if (next !== renaming) onRename(renaming, next);
      })
    ) {
      setRenaming(null);
      setNotice(`Sheet renamed to ${next}.`);
      // The renamed tab is mounted on the next render; the persistent menu
      // trigger is a reliable focus destination in controlled hosts too.
      menuButton.current?.focus();
    }
  };

  return (
    <div ref={root} className="rsp-sheet-navigation" onKeyDown={(event) => event.stopPropagation()}>
      <span className="rsp-sr-only" role="status">
        {notice}
      </span>
      {renaming && (
        <form
          className="rsp-sheet-rename"
          onSubmit={saveRename}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelRename();
            }
          }}
        >
          <label htmlFor={`${id}-name`}>Sheet name</label>
          <input
            ref={input}
            id={`${id}-name`}
            className="rsp-sheet-tab-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            data-testid={`rename-sheet-input-${renaming}`}
          />
          <button type="submit" className="rsp-sheet-action">
            Save
          </button>
          <button type="button" className="rsp-sheet-action" onClick={cancelRename}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <div id={`${id}-error`} className="rsp-sheet-error" role="alert">
          {error}
        </div>
      )}
      <div className="rsp-sheet-tabs">
        <div className="rsp-sheet-tabs-scroll" role="tablist" aria-label={`${workbookName} sheets`}>
          {sheets.map((sheet, index) => (
            <button
              type="button"
              role="tab"
              key={sheet}
              className={`rsp-sheet-tab${activeSheet === sheet ? ' rsp-sheet-tab-active' : ''}`}
              aria-controls={panelId}
              aria-selected={activeSheet === sheet}
              tabIndex={sheet === selected ? 0 : -1}
              title={sheet}
              data-testid={`sheet-tab-${sheet}`}
              onClick={() => {
                setMenuOpen(false);
                onSelect(sheet);
              }}
              onDoubleClick={() => startRename(sheet)}
              onKeyDown={(event) => {
                const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
                let next: number | undefined;
                if (event.key === 'ArrowRight')
                  next = (index + (rtl ? -1 : 1) + sheets.length) % sheets.length;
                if (event.key === 'ArrowLeft')
                  next = (index + (rtl ? 1 : -1) + sheets.length) % sheets.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = sheets.length - 1;
                if (next !== undefined) {
                  event.preventDefault();
                  onSelect(sheets[next]!);
                  focusTab(sheets[next]);
                }
                if (event.key === 'F2') {
                  event.preventDefault();
                  startRename(sheet);
                }
              }}
            >
              <span>{sheet}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rsp-add-sheet-button"
          title="Add Sheet"
          aria-label="Add Sheet"
          data-testid={`add-sheet-${workbookName}`}
          onClick={() => {
            setMenuOpen(false);
            run(onAdd);
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          ref={menuButton}
          type="button"
          className="rsp-icon-button rsp-sheet-menu-trigger"
          title="Sheet actions"
          aria-label={selected ? `Sheet actions for ${selected}` : 'Sheet actions'}
          disabled={!selected}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `${id}-menu` : undefined}
          onClick={() => setMenuOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {children}
      </div>
      {menuOpen && selected && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={`Actions for ${selected}`}
          className="rsp-sheet-menu"
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node) &&
              event.relatedTarget !== menuButton.current
            )
              setMenuOpen(false);
          }}
          onKeyDown={(event) => {
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
            );
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setMenuOpen(false);
              menuButton.current?.focus();
            }
          }}
        >
          <div className="rsp-sheet-menu-name" title={selected}>
            {selected}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => startRename(selected)}
            data-testid={`rename-sheet-${selected}`}
          >
            Rename sheet <span aria-hidden="true">F2</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-disabled={sheets.length <= 1}
            className="rsp-sheet-delete"
            data-testid={`delete-sheet-${selected}`}
            onClick={() => {
              if (sheets.length <= 1) return;
              if (window.confirm(`Delete sheet "${selected}" and its contents?`)) {
                if (run(() => onDelete(selected))) {
                  setMenuOpen(false);
                  setNotice(`Sheet ${selected} deleted.`);
                  menuButton.current?.focus();
                }
              }
            }}
          >
            Delete sheet
          </button>
          {sheets.length <= 1 && (
            <div className="rsp-sheet-menu-hint">Keep at least one sheet.</div>
          )}
        </div>
      )}
    </div>
  );
}

import {
  FormulaEngine,
  type CellAddress,
  type CellStyle,
  type SerializedCellValue,
  type SpreadsheetRange,
  type SpreadsheetRangeEnd,
  indexToColumn,
  parseCellReference,
  getCellReference,
  type RangeAddress
} from '@ricsam/formula-engine';

import type {
  SelectionManager,
  SelectionNavigationModel,
  SMCell,
  SMArea,
  SMTable
} from '@ricsam/selection-manager';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Spreadsheet, type SpreadsheetProps } from '../spreadsheet/spreadsheet';
import type {
  CellRenderContext,
  SpreadsheetColumnWidths,
  SpreadsheetRowHeights
} from '../types';
import type { WorkbookSelectionManager } from './workbook-selection-manager';
import { SheetNavigation } from './sheet-navigation';
import { useSchemeRoot } from '../utils/use-scheme-root';
import { type CellDataUpdate, ClipboardUtils } from '../clipboard/clipboard-manager';
import { normalizeBorderSides, hasAnyBorderSide } from './border-sides';
import { coerceCellInput, getCellDisplayText, getCellDisplayValue } from './cell-data-type';
import { queueCellEditError } from './cell-edit-error';

const getWrapCellStyle = (style?: CellStyle): React.CSSProperties =>
  style?.wrapText
    ? {
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
        textOverflow: 'clip',
        alignItems: 'flex-start'
      }
    : {};

const getWrapContentStyle = (style?: CellStyle): React.CSSProperties =>
  style?.wrapText
    ? {
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
        textOverflow: 'clip',
        width: '100%',
        minWidth: 0
      }
    : {};

const getBorderCellStyle = (style?: CellStyle): React.CSSProperties =>
  (() => {
    if (!style?.borderColor) {
      return {};
    }

    const borderSides = normalizeBorderSides(style.borderSides, true);
    if (!hasAnyBorderSide(borderSides)) {
      return {};
    }

    return {
      ...(borderSides.top && { borderTopColor: style.borderColor }),
      ...(borderSides.right && { borderRightColor: style.borderColor }),
      ...(borderSides.bottom && { borderBottomColor: style.borderColor }),
      ...(borderSides.left && { borderLeftColor: style.borderColor })
    };
  })();

// Icon Components
const Edit2Icon = ({ className = '', ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const CopyIcon = ({ className = '', ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const Trash2Icon = ({ className = '', ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
);

const PlusIcon = ({ className = '', ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

const MinusIcon = ({ className = '', ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M5 12h14" />
  </svg>
);

type SpreadsheetLayout = {
  columnWidths?: SpreadsheetColumnWidths;
  rowHeights?: SpreadsheetRowHeights;
};

export interface FormulaSheetProps
  extends Omit<
    SpreadsheetProps,
    | 'selection'
    | 'customCellStyle'
    | 'customCellRenderer'
    | 'components'
    | 'overlayChildren'
    | 'selectedOverlayId'
    | 'onOverlaySelect'
    | 'onOverlayChildrenChange'
    | 'overlayPlaceholder'
    | 'parentSelected'
  > {
  clipboardManager?: WorkbookClipboardManager;
  sheetName: string;
  workbookName: string;
  engine: FormulaEngine;
  verboseErrors?: boolean;
  selection?: SpreadsheetProps['selection'];
  selectionManager?: WorkbookSelectionManager;
  /** Stable identity used to distinguish duplicate mounted views of this sheet. */
  viewId?: string;
  customCellStyle?: (
    cell: CellRenderContext,
    internalStyle: React.CSSProperties
  ) => React.CSSProperties;
  customCellRenderer?: (
    cell: CellRenderContext,
    internalElement: React.ReactNode
  ) => React.ReactNode;
  // Add overlay component props
  components?: SpreadsheetProps['components'];
  overlayChildren?: SpreadsheetProps['overlayChildren'];
  selectedOverlayId?: SpreadsheetProps['selectedOverlayId'];
  onOverlaySelect?: SpreadsheetProps['onOverlaySelect'];
  onOverlayChildrenChange?: SpreadsheetProps['onOverlayChildrenChange'];
  overlayPlaceholder?: SpreadsheetProps['overlayPlaceholder'];
  /** Whether the grid child is selected (controls interactivity) */
  isSelected?: boolean;
  /** Optional toolbar to render above the sheet */
  toolbar?: React.ReactNode;
  /** When true, cells display raw formulas instead of computed values */
  showFormulas?: boolean;
}

function useEngine(engine: FormulaEngine): ReturnType<typeof FormulaEngine.prototype.getState> {
  const [state, setState] = useState<ReturnType<typeof FormulaEngine.prototype.getState>>(() =>
    engine.getState()
  );

  React.useEffect(() => {
    return engine.onUpdate(() => {
      setState(engine.getState());
    });
  }, [engine]);

  return state;
}

export class WorkbookClipboardManager extends ClipboardUtils {
  constructor(private engine: FormulaEngine) {
    super();
  }
  copiedCells: CellAddress[] = [];
  signature: string = '';
  isCut: boolean = false;

  public triggerCopy(context: {
    workbookName: string;
    sheetName: string;
    selectionManager: SelectionManager;
    copyType: 'value' | 'formula';
    cut?: boolean;
  }): void {
    const cellData = this.engine.getSheet({
      workbookName: context.workbookName,
      sheetName: context.sheetName
    })?.content;
    if (!cellData) return;
    const extractedCells = this.extractCellsFromSelection(context.selectionManager, cellData);
    if (!extractedCells) return;
    const { width, height, cells } = extractedCells;
    const valueExportGrid = this.createExportGrid(width, height);
    const formulaExportGrid = this.createExportGrid(width, height);
    this.copiedCells = [];
    this.isCut = context.cut ?? false;
    cells.forEach(({ relative, absolute }) => {
      const cellAddress: CellAddress = {
        workbookName: context.workbookName,
        sheetName: context.sheetName,
        colIndex: absolute.columnIndex,
        rowIndex: absolute.rowIndex
      };
      this.copiedCells.push(cellAddress);
      const value = this.engine.getCellValue(cellAddress, false);
      const formula = cellData.get(getCellReference(cellAddress));
      valueExportGrid[relative.rowIndex]![relative.columnIndex] = getCellDisplayValue(value);
      formulaExportGrid[relative.rowIndex]![relative.columnIndex] = formula;
    });
    this.signature = this.getTsvString(context.copyType === 'formula' ? formulaExportGrid : valueExportGrid);
    this.writeToOsClipboard(context.copyType === 'formula' ? formulaExportGrid : valueExportGrid);
  }
  public triggerPaste(context: {
    workbookName: string;
    sheetName: string;
    selectionManager: SelectionManager;
    updates: CellDataUpdate[];
    rawString: string;
    pasteType: 'value' | 'formula';
  }): void {
    if (context.rawString === this.signature) {
      // Internal paste operation - use smartPaste to handle both copy and fill
      const selections = context.selectionManager.selections;
      if (!selections || selections.length === 0) return;

      // Convert each SMArea to SpreadsheetRange
      const convertSMAreaToSpreadsheetRange = (area: SMArea): SpreadsheetRange => {
        return {
          start: {
            col: area.start.col,
            row: area.start.row
          },
          end: {
            col:
              area.end.col.type === 'infinity'
                ? { type: 'infinity' as const, sign: 'positive' as const }
                : { type: 'number' as const, value: area.end.col.value },
            row:
              area.end.row.type === 'infinity'
                ? { type: 'infinity' as const, sign: 'positive' as const }
                : { type: 'number' as const, value: area.end.row.value }
          }
        };
      };

      const areas = selections.map(convertSMAreaToSpreadsheetRange);

      console.log('pasting', { cut: this.isCut });
      this.engine.smartPaste(
        this.copiedCells,
        {
          workbookName: context.workbookName,
          sheetName: context.sheetName,
          areas
        },
        {
          cut: this.isCut,
          type: context.pasteType,
          include: 'all'
        }
      );

      // Reset isCut after paste
      this.isCut = false;
    } else {
      // External paste operation
      context.selectionManager.saveCellValues(context.updates);
    }
  }
}

export function FormulaSheet({
  sheetName,
  workbookName,
  engine,
  verboseErrors = false,
  selection,
  selectionManager,
  viewId,
  customCellStyle,
  customCellRenderer,
  onCellDataChangeError = queueCellEditError,
  // Add overlay props
  components,
  overlayChildren,
  selectedOverlayId,
  onOverlaySelect,
  onOverlayChildrenChange,
  overlayPlaceholder,
  clipboardManager: controlledClipboardManager,
  isSelected = false,
  toolbar,
  showFormulas = false,
  ...rest
}: FormulaSheetProps) {
  const schemeRoot = useSchemeRoot();
  const [selectedArea, setSelectedArea] = useState<SMArea | null>(null);

  const clipboardManager = React.useMemo(
    () => controlledClipboardManager ?? new WorkbookClipboardManager(engine!),
    [controlledClipboardManager, engine]
  );

  const state = useEngine(engine);

  const sheet = state.workbooks.get(workbookName)?.sheets.get(sheetName);

  const getEngineTableAt = useCallback(
    (cell: SMCell): SMTable | undefined => {
      const table = engine.isCellInTable({
        workbookName,
        sheetName,
        rowIndex: cell.row,
        colIndex: cell.col
      });
      if (!table) return undefined;

      const endRow =
        table.endRow.type === 'number'
          ? { type: 'number' as const, value: table.endRow.value }
          : { type: 'infinity' as const };
      const endCol = {
        type: 'number' as const,
        value: table.start.colIndex + table.headers.size - 1
      };
      const hasDataRows = endRow.type === 'infinity' || endRow.value > table.start.rowIndex;

      return {
        id: `${table.workbookName}/${table.name}`,
        bounds: {
          start: { row: table.start.rowIndex, col: table.start.colIndex },
          end: { row: endRow, col: endCol }
        },
        ...(hasDataRows
          ? {
              dataBounds: {
                start: {
                  row: table.start.rowIndex + 1,
                  col: table.start.colIndex
                },
                end: { row: endRow, col: endCol }
              }
            }
          : {})
      };
    },
    [engine, sheetName, workbookName]
  );
  const formulaNavigation = useMemo<SelectionNavigationModel>(
    () => ({
      ...selection?.navigation,
      getTableAt: selection?.navigation?.getTableAt ?? getEngineTableAt
    }),
    [getEngineTableAt, selection?.navigation]
  );

  // Handle cell data changes from the spreadsheet
  const onCellDataChange = useCallback(
    (updatedSpreadsheet: Map<string, SerializedCellValue>) => {
      const data = new Map<string, SerializedCellValue>(updatedSpreadsheet);
      data.forEach((value, key) => {
        if (typeof value === 'string') {
          const { colIndex, rowIndex } = parseCellReference(key);
          const coercedValue = coerceCellInput(
            value,
            engine.getCellDataType({ workbookName, sheetName, colIndex, rowIndex })
          );
          if (coercedValue === undefined) {
            data.delete(key);
          } else {
            data.set(key, coercedValue);
          }
        }
      });
      engine.setSheetContent({ sheetName, workbookName }, data);
    },
    [sheetName, engine, workbookName]
  );

  const passedSelectionEffects = selection?.effects;

  // Selection manager effects for tracking cell selection
  const selectionManagerEffects = useCallback(
    (spreadsheetSelectionManager: SelectionManager) => {
      const convertSmAreaToSpreadsheetRange = (area: SMArea): SpreadsheetRange => {
        const rowEnd: SpreadsheetRangeEnd =
          area.end.row.type === 'infinity'
            ? {
                type: 'infinity',
                sign: 'positive'
              }
            : {
                type: 'number',
                value: area.end.row.value
              };
        const colEnd: SpreadsheetRangeEnd =
          area.end.col.type === 'infinity'
            ? {
                type: 'infinity',
                sign: 'positive'
              }
            : {
                type: 'number',
                value: area.end.col.value
              };
        return {
          start: {
            col: area.start.col,
            row: area.start.row
          },
          end: {
            row: rowEnd,
            col: colEnd
          }
        };
      };

      const cleanups = [
        spreadsheetSelectionManager.listenToCopy((cut) => {
          console.log('cut??', cut);
          clipboardManager.triggerCopy({
            workbookName,
            sheetName,
            selectionManager: spreadsheetSelectionManager,
            copyType: showFormulas ? 'formula' : 'value',
            cut
          });
        }),
        spreadsheetSelectionManager.listenToPaste(({ updates, rawString }) => {
          clipboardManager.triggerPaste({
            workbookName,
            sheetName,
            selectionManager: spreadsheetSelectionManager,
            updates,
            rawString,
            pasteType: 'formula'
          });
        }),
        spreadsheetSelectionManager.listenToFill((ev) => {
          if (ev.type === 'extend') {
            engine.autoFill(
              { sheetName, workbookName },
              convertSmAreaToSpreadsheetRange(ev.seedRange),
              [convertSmAreaToSpreadsheetRange(ev.fillRange)],
              ev.direction
            );
          } else {
            engine.clearSpreadsheetRange({
              sheetName,
              workbookName,
              range: convertSmAreaToSpreadsheetRange(ev.rangeToClear)
            });
          }
        }),
        spreadsheetSelectionManager.observeStateChange(
          (state) => {
            const currentSelection: SMArea | undefined =
              state.selections.length === 1 ? state.selections[0] : undefined;
            return currentSelection;
          },
          (selection) => {
            setSelectedArea(selection ?? null);
          }
        )
      ];

      const handleUndoRedoKeyDown = (event: KeyboardEvent) => {
        if (!spreadsheetSelectionManager.hasFocus) return;
        if (spreadsheetSelectionManager.isEditing.type !== 'none') return;

        const target = event.target;
        if (target instanceof HTMLElement) {
          const isEditableTarget =
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            Boolean(target.closest('[contenteditable="true"]'));

          if (isEditableTarget) return;
        }

        if (!event.metaKey && !event.ctrlKey) return;

        const key = event.key.toLowerCase();
        const isUndo = key === 'z' && !event.shiftKey;
        const isRedo = key === 'y' || (key === 'z' && event.shiftKey);

        if (!isUndo && !isRedo) return;

        event.preventDefault();
        event.stopPropagation();

        if (isUndo) {
          engine.undo();
        } else {
          engine.redo();
        }
      };

      document.addEventListener('keydown', handleUndoRedoKeyDown);
      cleanups.push(() => {
        document.removeEventListener('keydown', handleUndoRedoKeyDown);
      });

      // Register this spreadsheet's SelectionManager with the WorkbookSelectionManager
      if (selectionManager) {
        const workbookManagerCleanup = selectionManager.add(spreadsheetSelectionManager, {
          workbookName,
          sheetName,
          ...(viewId === undefined ? {} : { viewId })
        });
        cleanups.push(workbookManagerCleanup);
      }

      // Call user-provided effects if present
      let userCleanup: (() => void) | void;
      if (passedSelectionEffects) {
        userCleanup = passedSelectionEffects(spreadsheetSelectionManager);
      }

      return () => {
        cleanups.forEach((cleanup) => cleanup());
        if (userCleanup) {
          userCleanup();
        }
      };
    },
    [
      clipboardManager,
      engine,
      passedSelectionEffects,
      selectionManager,
      sheetName,
      showFormulas,
      viewId,
      workbookName
    ]
  );

  // Selection changes must not invalidate engine rendering. Invalidate on every
  // engine update (including other sheets): conditional styles can depend on any
  // formula input, not just this sheet's content. Bound the cache for long scrolls.
  const renderCallbacks = useMemo(() => {
    type RenderStyle = CellStyle & { fontFamily?: string };
    const metadata = engine.getWorkbookMetadata(workbookName) as
      { defaultCellStyle?: RenderStyle } | undefined;
    const defaults = metadata?.defaultCellStyle;
    const fontStyle = (style?: RenderStyle): React.CSSProperties => ({
      ...(style?.fontFamily && { fontFamily: style.fontFamily }),
      ...(style?.bold !== undefined && { fontWeight: style.bold ? 'bold' : 'normal' }),
      ...(style?.italic !== undefined && { fontStyle: style.italic ? 'italic' : 'normal' }),
      ...(style?.underline !== undefined && { textDecoration: style.underline ? 'underline' : 'none' })
    });
    const styles = new Map<string, RenderStyle | undefined>();
    const getStyle = (cell: CellRenderContext): RenderStyle | undefined => {
      if (styles.has(cell.id)) return styles.get(cell.id);
      const explicit = engine.getCellStyle({
        sheetName, workbookName, colIndex: cell.colIndex, rowIndex: cell.rowIndex
      });
      const style = defaults ? { ...defaults, ...explicit } : explicit;
      if (styles.size >= 4096) styles.clear();
      styles.set(cell.id, style);
      return style;
    };
    return {
      customCellStyle: (cell: CellRenderContext) => {
        // Check for conditional styling first
        const conditionalStyle = getStyle(cell);

        const tableInfo = engine.isCellInTable({
          sheetName,
          colIndex: cell.colIndex,
          rowIndex: cell.rowIndex,
          workbookName
        });

        if (!tableInfo) {
          // Not in a table, apply the engine style first and always give the
          // consumer a chance to augment it. Reference highlights, search
          // results and other transient decorations commonly target plain
          // cells, so limiting this callback to table cells makes the API
          // ineffective for those use cases.
          const style: React.CSSProperties = conditionalStyle
            ? {
                ...(conditionalStyle.backgroundColor && {
                  backgroundColor: conditionalStyle.backgroundColor
                }),
                ...(conditionalStyle.color && {
                  color: conditionalStyle.color
                }),
                ...(conditionalStyle.fontSize && {
                  fontSize: conditionalStyle.fontSize
                }),
                ...fontStyle(conditionalStyle),
                ...getBorderCellStyle(conditionalStyle),
                ...getWrapCellStyle(conditionalStyle)
              }
            : {};

          return customCellStyle ? customCellStyle(cell, style) : style;
        }

        const isHeaderRow = cell.rowIndex === tableInfo.start.rowIndex;
        const isFirstColumn = cell.colIndex === tableInfo.start.colIndex;
        const isLastColumn = cell.colIndex === tableInfo.start.colIndex + tableInfo.headers.size - 1;

        // Calculate if this is the last row of the table
        const isLastRow =
          tableInfo.endRow.type === 'number' ? cell.rowIndex === tableInfo.endRow.value : false; // For infinite tables, we don't style the last row differently

        // Excel-like table styling. These custom properties are declared in
        // the package stylesheet (`styles.css`) and resolve through
        // `light-dark()`, so tables follow the active color scheme.
        const style: React.CSSProperties = {
          border: '1px solid var(--_rsp-table-border-light)'
        };

        if (isHeaderRow) {
          // Header row styling - accent theme like Excel
          style.backgroundColor = 'var(--_rsp-table-header-bg)';
          style.color = 'var(--_rsp-table-header-color)';
          style.fontWeight = 'bold';
          style.borderBottom = '2px solid var(--_rsp-table-header-border)';
        } else {
          // Data rows - alternating background
          const dataRowIndex = cell.rowIndex - tableInfo.start.rowIndex - 1;
          if (dataRowIndex % 2 === 0) {
            style.backgroundColor = 'var(--_rsp-table-even-row-bg)';
          } else {
            style.backgroundColor = 'var(--_rsp-table-odd-row-bg)';
          }
        }

        // Border styling
        if (isFirstColumn) {
          style.borderLeft = '2px solid var(--_rsp-table-border-color)';
        }
        if (isLastColumn) {
          style.borderRight = '2px solid var(--_rsp-table-border-color)';
        }
        if (isHeaderRow) {
          style.borderTop = '2px solid var(--_rsp-table-border-color)';
        }
        if (isLastRow) {
          style.borderBottom = '2px solid var(--_rsp-table-border-color)';
        }

        // Merge conditional styling with table styling
        // User custom styles can now override table header styles
        if (conditionalStyle?.backgroundColor) {
          style.backgroundColor = conditionalStyle.backgroundColor;
        }
        // Apply text color from conditional styling (overrides header white text if user wants)
        if (conditionalStyle?.color) {
          style.color = conditionalStyle.color;
        }
        // Apply font size from conditional styling
        if (conditionalStyle?.fontSize) {
          style.fontSize = conditionalStyle.fontSize;
        }
        Object.assign(style, fontStyle(conditionalStyle));
        Object.assign(style, getBorderCellStyle(conditionalStyle));
        Object.assign(style, getWrapCellStyle(conditionalStyle));

        if (customCellStyle) {
          return customCellStyle(cell, style);
        }

        return style;
      },
      customCellRenderer: (cell: CellRenderContext) => {
        const cellRef = getCellReference({
          colIndex: cell.colIndex,
          rowIndex: cell.rowIndex
        });

        // When showFormulas is enabled, display the raw cell content (formula string)
        // instead of the computed value from the engine
        const value = showFormulas
          ? sheet?.content.get(cellRef)
          : engine.getCellValue(
              {
                sheetName,
                workbookName,
                colIndex: cell.colIndex,
                rowIndex: cell.rowIndex
              },
              verboseErrors
            );

        const conditionalStyle = getStyle(cell);

        const conditionalStyleProps: React.CSSProperties = {};
        if (conditionalStyle?.backgroundColor) {
          conditionalStyleProps.backgroundColor = conditionalStyle.backgroundColor;
        }
        if (conditionalStyle?.color) {
          conditionalStyleProps.color = conditionalStyle.color;
        }
        if (conditionalStyle?.fontSize) {
          conditionalStyleProps.fontSize = conditionalStyle.fontSize;
        }
        Object.assign(conditionalStyleProps, fontStyle(conditionalStyle), getWrapContentStyle(conditionalStyle));

        let defaultElement: React.ReactNode;
        if (showFormulas) {
          // In show-formulas mode, always render raw content as-is (no number formatting)
          defaultElement = (
            <div
              data-conditional-background={conditionalStyle?.backgroundColor}
              data-conditional-text-color={conditionalStyle?.color}
              style={conditionalStyleProps}
            >
              {getCellDisplayText(value)}
            </div>
          );
        } else if (typeof value === 'boolean') {
          defaultElement = (
            <div
              data-conditional-background={conditionalStyle?.backgroundColor}
              data-conditional-text-color={conditionalStyle?.color}
              data-type="boolean"
              style={{
                ...conditionalStyleProps,
                width: '100%',
                textAlign: 'center',
                fontFamily: conditionalStyle?.fontFamily ?? "'Courier New', monospace"
              }}
            >
              {value ? 'TRUE' : 'FALSE'}
            </div>
          );
        } else if (typeof value === 'number') {
          // Format numbers nicely
          defaultElement = (
            <div
              data-conditional-background={conditionalStyle?.backgroundColor}
              data-conditional-text-color={conditionalStyle?.color}
              data-type="number"
              style={{ ...conditionalStyleProps, width: '100%', textAlign: 'right' }}
            >
              {value.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 10
              })}
            </div>
          );
        } else {
          defaultElement = (
            <div
              data-conditional-background={conditionalStyle?.backgroundColor}
              data-conditional-text-color={conditionalStyle?.color}
              style={{ ...conditionalStyleProps, width: '100%', textAlign: 'left' }}
            >
              {getCellDisplayText(value)}
            </div>
          );
        }

        if (customCellRenderer) {
          return customCellRenderer(cell, defaultElement);
        }
        return defaultElement;
      }
    };
  }, [engine, state, workbookName, sheetName, sheet, showFormulas, verboseErrors,
      customCellStyle, customCellRenderer]);

  // If the sheet doesn't exist (e.g. during a rename where the engine has
  // updated but React hasn't re-rendered with the new sheet name yet),
  // render nothing. The next render will have the correct sheet name.
  if (!sheet) {
    return (
      <div className="rsp-root rsp-workbook" {...schemeRoot}>
        {toolbar}
        <div style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div className="rsp-root rsp-workbook" {...schemeRoot}>
      {/* Optional Toolbar */}
      {toolbar}

      {/* Main spreadsheet area */}
      <div className="rsp-workbook-body">
        <Spreadsheet
          disableClipboard={true}
          style={{ height: '100%', width: '100%' }}
          cellData={sheet?.content}
          onCellDataChange={onCellDataChange}
          onCellDataChangeError={onCellDataChangeError}
          {...rest}
          // Add overlay props
          components={components}
          overlayChildren={overlayChildren}
          selectedOverlayId={selectedOverlayId}
          onOverlaySelect={onOverlaySelect}
          onOverlayChildrenChange={onOverlayChildrenChange}
          overlayPlaceholder={overlayPlaceholder}
          parentSelected={isSelected}
          selection={{
            ...selection,
            navigation: formulaNavigation,
            effects: selectionManagerEffects
          }}
          containerProps={
            (isSelected && selectedArea
              ? {
                  'data-grid-no-interaction': 'true'
                }
              : {}) as React.HTMLAttributes<HTMLDivElement>
          }
          {...renderCallbacks}
        />
      </div>
    </div>
  );
}

export interface FormulaWorkbookProps
  extends Omit<
    SpreadsheetProps,
    | 'cellData'
    | 'onCellDataChange'
    | 'selection'
    | 'customCellStyle'
    | 'customCellRenderer'
    | 'components'
    | 'overlayChildren'
    | 'selectedOverlayId'
    | 'onOverlaySelect'
    | 'onOverlayChildrenChange'
    | 'overlayPlaceholder'
    | 'parentSelected'
    | 'columnWidths'
    | 'onColumnWidthsChange'
    | 'rowHeights'
    | 'onRowHeightsChange'
  > {
  workbookName: string;
  clipboardManager?: WorkbookClipboardManager;
  engine: FormulaEngine;
  activeSheet?: string;
  onActiveSheetChange?: (sheetName: string) => void;
  verboseErrors?: boolean;
  selection?: SpreadsheetProps['selection'];
  selectionManager?: WorkbookSelectionManager;
  /** Stable identity used to distinguish duplicate mounted views of this workbook. */
  viewId?: string;
  customCellStyle?: (
    cell: CellRenderContext,
    internalStyle: React.CSSProperties
  ) => React.CSSProperties;
  customCellRenderer?: (
    cell: CellRenderContext,
    internalElement: React.ReactNode
  ) => React.ReactNode;
  // Add overlay component props with per-sheet support
  components?: SpreadsheetProps['components'];
  // Map of sheet name to overlay children for that sheet
  sheetOverlayChildren?: Record<string, SpreadsheetProps['overlayChildren']>;
  // Map of sheet name to selected overlay ID for that sheet
  sheetSelectedOverlayIds?: Record<string, SpreadsheetProps['selectedOverlayId']>;
  sheetLayouts?: Record<string, SpreadsheetLayout>;
  onSheetColumnWidthsChange?: (sheetName: string, columnWidths: SpreadsheetColumnWidths) => void;
  onSheetRowHeightsChange?: (sheetName: string, rowHeights: SpreadsheetRowHeights) => void;
  onOverlaySelect?: (sheetName: string, overlayId: string | null) => void;
  onOverlayChildrenChange?: (
    sheetName: string,
    children: NonNullable<SpreadsheetProps['overlayChildren']>
  ) => void;
  overlayPlaceholder?: SpreadsheetProps['overlayPlaceholder'];
  /** Whether the grid child is selected (controls interactivity) */
  isSelected?: boolean;
  /** Optional toolbar to render above the workbook */
  toolbar?: React.ReactNode;
  /** When true, cells display raw formulas instead of computed values */
  showFormulas?: boolean;
}

export function FormulaWorkbook({
  clipboardManager: controlledClipboardManager,
  workbookName,
  engine,
  activeSheet: controlledActiveSheet,
  onActiveSheetChange,
  verboseErrors = false,
  selectionManager,
  viewId,
  // Add overlay props
  components,
  sheetOverlayChildren,
  sheetSelectedOverlayIds,
  sheetLayouts,
  onSheetColumnWidthsChange,
  onSheetRowHeightsChange,
  onOverlaySelect,
  onOverlayChildrenChange,
  overlayPlaceholder,
  isSelected = false,
  toolbar,
  showFormulas = false,
  ...rest
}: FormulaWorkbookProps) {
  const schemeRoot = useSchemeRoot();
  useEngine(engine);
  const panelId = React.useId();
  const [spreadsheetZoom, setSpreadsheetZoom] = useState(1);

  const clipboardManager = React.useMemo(
    () => controlledClipboardManager ?? new WorkbookClipboardManager(engine!),
    [controlledClipboardManager, engine]
  );

  // Recompute on every render because the engine mutates sheet maps in place.
  // Depending on the Map reference in useMemo makes tab order stale after updates.
  const sheetNames = engine.getOrderedSheetNames(workbookName);

  // Internal state for uncontrolled mode
  const [internalActiveSheet, setInternalActiveSheet] = useState<string>(() => {
    return sheetNames[0] || '';
  });

  // Track if component is controlled
  const isControlledRef = useRef(controlledActiveSheet !== undefined);

  // Check for controlled/uncontrolled mode changes
  React.useEffect(() => {
    const isCurrentlyControlled = controlledActiveSheet !== undefined;
    if (isControlledRef.current !== isCurrentlyControlled) {
      console.error(
        `FormulaWorkbook: Component changed from ${isControlledRef.current ? 'controlled' : 'uncontrolled'} to ${isCurrentlyControlled ? 'controlled' : 'uncontrolled'} mode. ` +
          `A component should not switch between controlled and uncontrolled modes. ` +
          `Decide between using activeSheet and onActiveSheetChange props (controlled) or neither (uncontrolled) for the lifetime of the component.`
      );
    }
    isControlledRef.current = isCurrentlyControlled;
  }, [controlledActiveSheet]);

  // Use controlled value if provided, otherwise use internal state
  const activeSheet = controlledActiveSheet ?? internalActiveSheet;

  // Handle sheet changes
  const handleActiveSheetChange = useCallback(
    (sheetName: string) => {
      if (onActiveSheetChange) {
        onActiveSheetChange(sheetName);
      }
      if (controlledActiveSheet === undefined) setInternalActiveSheet(sheetName);
    },
    [onActiveSheetChange, controlledActiveSheet]
  );

  // Get overlay and layout data for the active sheet
  const activeSheetOverlayChildren = sheetOverlayChildren?.[activeSheet];
  const activeSheetSelectedOverlayId = sheetSelectedOverlayIds?.[activeSheet];
  const activeSheetColumnWidths = sheetLayouts?.[activeSheet]?.columnWidths;
  const activeSheetRowHeights = sheetLayouts?.[activeSheet]?.rowHeights;

  // Create sheet-specific callbacks
  const handleOverlaySelect = useCallback(
    (overlayId: string | null) => {
      onOverlaySelect?.(activeSheet, overlayId);
    },
    [onOverlaySelect, activeSheet]
  );

  const handleOverlayChildrenChange = useCallback(
    (children: NonNullable<SpreadsheetProps['overlayChildren']>) => {
      onOverlayChildrenChange?.(activeSheet, children);
    },
    [onOverlayChildrenChange, activeSheet]
  );

  const handleColumnWidthsChange = useCallback(
    (columnWidths: SpreadsheetColumnWidths) => {
      onSheetColumnWidthsChange?.(activeSheet, columnWidths);
    },
    [activeSheet, onSheetColumnWidthsChange]
  );

  const handleRowHeightsChange = useCallback(
    (rowHeights: SpreadsheetRowHeights) => {
      onSheetRowHeightsChange?.(activeSheet, rowHeights);
    },
    [activeSheet, onSheetRowHeightsChange]
  );

  // Add new sheet handler
  const addSheet = () => {
    const newSheet = engine.createSheet({ workbookName });
    handleActiveSheetChange(newSheet.name);
  };

  const renameSheet = (oldName: string, newName: string) => {
    engine.renameSheet({ workbookName, sheetName: oldName, newSheetName: newName });
    if (activeSheet === oldName) handleActiveSheetChange(newName);
  };

  // Delete sheet
  const deleteSheet = (sheetName: string) => {
    if (sheetNames.length <= 1) {
      console.error('Cannot delete the last sheet');
      return;
    }

    engine.removeSheet({ workbookName, sheetName });

    // If we deleted the active sheet, select the next sheet, or the previous one at the end.
    if (activeSheet === sheetName) {
      const remainingSheets = sheetNames.filter((name) => name !== sheetName);
      const nextSheet =
        remainingSheets[Math.min(sheetNames.indexOf(sheetName), remainingSheets.length - 1)];
      if (nextSheet) {
        handleActiveSheetChange(nextSheet);
      }
    }
  };

  return (
    <div className="rsp-root rsp-workbook" {...schemeRoot}>
      {/* Optional Toolbar */}
      {toolbar}

      {/* Workbook Header */}
      <div className="rsp-workbook-header">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          <span className="rsp-workbook-name" data-testid={`workbook-name-${workbookName}`}>
            {workbookName}
          </span>
        </div>
        <span className="rsp-zoom-value" data-testid={`sheet-count-${workbookName}`}>
          Sheets: {sheetNames.length}
        </span>
      </div>

      {/* Spreadsheet Content */}
      <div id={panelId} role="tabpanel" aria-label={activeSheet || 'Sheet'} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            transform: spreadsheetZoom !== 1 ? `scale(${spreadsheetZoom})` : undefined,
            transformOrigin: '0 0',
            width: spreadsheetZoom !== 1 ? `${100 / spreadsheetZoom}%` : '100%',
            height: spreadsheetZoom !== 1 ? `${100 / spreadsheetZoom}%` : '100%'
          }}
        >
          <FormulaSheet
            key={`${workbookName}-${activeSheet}`}
            sheetName={activeSheet}
            workbookName={workbookName}
            engine={engine}
            verboseErrors={verboseErrors}
            selectionManager={selectionManager}
            viewId={viewId}
            {...rest}
            // Pass overlay props for the active sheet
            components={components}
            overlayChildren={activeSheetOverlayChildren}
            selectedOverlayId={activeSheetSelectedOverlayId}
            columnWidths={activeSheetColumnWidths}
            onColumnWidthsChange={handleColumnWidthsChange}
            rowHeights={activeSheetRowHeights}
            onRowHeightsChange={handleRowHeightsChange}
            onOverlaySelect={handleOverlaySelect}
            onOverlayChildrenChange={handleOverlayChildrenChange}
            overlayPlaceholder={overlayPlaceholder}
            clipboardManager={clipboardManager}
            isSelected={isSelected}
            showFormulas={showFormulas}
          />
        </div>
      </div>

      <SheetNavigation sheets={sheetNames} activeSheet={activeSheet} workbookName={workbookName} panelId={panelId}
        onSelect={handleActiveSheetChange} onAdd={addSheet} onRename={renameSheet} onDelete={deleteSheet}>

        {/* Spreadsheet Zoom Controls - pinned to the right */}
        <div className="rsp-zoom-controls">
          <button
            type="button"
            className="rsp-icon-button"
            onClick={() => setSpreadsheetZoom(Math.max(0.5, Math.round((spreadsheetZoom - 0.1) * 10) / 10))}
            disabled={spreadsheetZoom <= 0.5}
            title="Zoom Out"
            style={{ opacity: spreadsheetZoom <= 0.5 ? 0.5 : 1 }}
          >
            <MinusIcon style={{ width: 12, height: 12 }} />
          </button>
          <button type="button" className="rsp-zoom-value rsp-zoom-reset" aria-label={`Zoom ${Math.round(spreadsheetZoom * 100)}%. Reset to 100%`} title="Reset zoom to 100%" onClick={() => setSpreadsheetZoom(1)}>{Math.round(spreadsheetZoom * 100)}%</button>
          <button
            type="button"
            className="rsp-icon-button"
            onClick={() => setSpreadsheetZoom(Math.min(2, Math.round((spreadsheetZoom + 0.1) * 10) / 10))}
            disabled={spreadsheetZoom >= 2}
            title="Zoom In"
            style={{ opacity: spreadsheetZoom >= 2 ? 0.5 : 1 }}
          >
            <PlusIcon style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </SheetNavigation>
    </div>
  );
}

// Export WorkbookSelectionManager
export { WorkbookSelectionManager } from './workbook-selection-manager';

/**
 * Side-by-side light/dark harness for the package's own styling.
 *
 * Run with:  bun run demo
 *
 * Each pane pins `color-scheme` on an ancestor of `.rsp-root`. The grid must
 * follow that pin rather than the OS preference, so this page renders both
 * themes simultaneously regardless of the host system setting.
 */
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { FormulaEngine } from "@ricsam/formula-engine";
import { FormulaWorkbook } from "../src/lib";
import "../src/styles.css";

const WORKBOOK = "Demo";

const finiteRange = (startCol: number, startRow: number, endCol: number, endRow: number) => ({
  start: { col: startCol, row: startRow },
  end: {
    col: { type: "number" as const, value: endCol },
    row: { type: "number" as const, value: endRow },
  },
});

function buildEngine() {
  const engine = FormulaEngine.buildEmpty();
  engine.addWorkbook(WORKBOOK);
  engine.addSheet({ workbookName: WORKBOOK, sheetName: "Model" });
  engine.addSheet({ workbookName: WORKBOOK, sheetName: "Inputs" });

  engine.setSheetContent(
    { workbookName: WORKBOOK, sheetName: "Model" },
    new Map<string, string | number | boolean | undefined>([
      ["A1", "PRODUCT"], ["B1", "UNITS"], ["C1", "UNIT PRICE"], ["D1", "REVENUE"],
      ["A2", "Starter"], ["B2", 120], ["C2", 29], ["D2", "=B2*C2"],
      ["A3", "Pro"], ["B3", 65], ["C3", 99], ["D3", "=B3*C3"],
      ["A4", "Team"], ["B4", 28], ["C4", 249], ["D4", "=B4*C4"],
      ["A5", "Enterprise"], ["B5", 8], ["C5", 1200], ["D5", "=B5*C5"],
      ["A6", "Total"], ["B6", "=SUM(B2:B5)"], ["D6", "=SUM(D2:D5)"],
      ["A8", "GROWTH"], ["B8", "Multiplier"], ["C8", 1.2], ["D8", "=D6*C8"],
    ]),
  );

  engine.setSheetContent(
    { workbookName: WORKBOOK, sheetName: "Inputs" },
    new Map<string, string | number | boolean | undefined>([
      ["A1", "ASSUMPTION"], ["B1", "VALUE"],
      ["A2", "Growth multiplier"], ["B2", 1.2],
    ]),
  );

  const area = (sheetName: string, sc: number, sr: number, ec: number, er: number) => ({
    workbookName: WORKBOOK,
    sheetName,
    range: finiteRange(sc, sr, ec, er),
  });

  // Literal light fills, exactly like a real document model would store. These
  // must stay readable even when the grid renders in dark mode.
  engine.addCellStyle({
    areas: [area("Model", 0, 0, 3, 0), area("Inputs", 0, 0, 1, 0)],
    style: { bold: true, backgroundColor: "#eef2ff", color: "#3730a3" },
  });
  engine.addCellStyle({
    areas: [area("Model", 0, 5, 3, 5)],
    style: { bold: true, backgroundColor: "#f1f5f9" },
  });
  engine.addCellStyle({
    areas: [area("Model", 0, 7, 3, 7)],
    style: { bold: true, backgroundColor: "#ecfdf5", color: "#047857" },
  });

  engine.clearUndoRedoHistory();
  return engine;
}

const engineLight = buildEngine();
const engineDark = buildEngine();

function Pane({ scheme, engine }: { scheme: "light" | "dark"; engine: FormulaEngine }) {
  return (
    <div className={`pane ${scheme}`}>
      <h2>{scheme}</h2>
      <div className="stage">
        <FormulaWorkbook engine={engine} workbookName={WORKBOOK} isSelected />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="panes">
      <Pane scheme="light" engine={engineLight} />
      <Pane scheme="dark" engine={engineDark} />
    </div>
  </StrictMode>,
);

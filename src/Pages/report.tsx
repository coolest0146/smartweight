import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Search, Filter, Printer } from "lucide-react";
import { fetchWeighings, ReadTicketByNumber } from "../services/database";
import { ReadVehicleById } from "../services/vehicles";
import { ReadUserById } from "../services/database"; // <- adjust to wherever this function lives
import { executeSilentHtmlPrint } from "../services/printer";
import {
  PrinterSettings,
  getPrinterSettings,
  buildInvoiceHtml,
  mapTicketRow,
  withVehicle,
} from "../services/PrinterSetting";

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#ffffff",
  panel: "#ffffff",
  panelSoft: "#eff6ff", // tailwind blue-50, for input/select backgrounds
  border: "#bfdbfe", // tailwind blue-200
  text: "#000000",
  dim: "#1e3a8a", // dark blue for secondary/dim text (readable on white)
  green: "#16a34a",
  orange: "#ea580c",
  amber: "#d97706",
  blue: "#93c5fd", // blue-300
  cyan: "#0891b2",
  red: "#dc2626",
  slate: "#475569",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Weighing = {
  id: string;
  ticketNumber: string; // NEW — used to load the full ticket for printing
  vehicleId: string; // plate number
  company: string; // transporter
  material: string; // NEW — commodity
  destination: string; // NEW
  tare: number;
  gross: number;
  net: number;
  limit: number; // max allowed weight
  operator: string;
  driver: string;
  date: string; // local yyyy-mm-dd
  time: string; // local HH:mm
  status: "Pass" | "Overload";
};

type Period = "all" | "daily" | "weekly" | "monthly";

// Printing a ticket from the report is always a reprint of an already-issued
// ticket. Set to false if you want reports to print a clean copy instead.
const MARK_REPRINTS_AS_DUPLICATE = true;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
function Panel({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`rounded-xl ${className}`} style={{ ...style }}>
      {children}
    </div>
  );
}

function StatusPill({ w }: { w: Weighing }) {
  const c = w.status === "Pass" ? C.green : C.red;
  const excess = w.status === "Overload" && w.limit > 0 ? w.gross - w.limit : 0;
  return (
    <div className="flex flex-col leading-tight">
      <span className="inline-flex rounded-md py-0.5 text-xs font-semibold" style={{ color: c }}>
        {w.status}
      </span>
      {excess > 0 && (
        <span className="text-[10px] font-semibold" style={{ color: C.red }}>
          +{excess.toLocaleString()} kg
        </span>
      )}
    </div>
  );
}

/** Text cell that truncates with an ellipsis and shows the full value on hover. */
function TextCell({ value, className = "" }: { value?: string | null; className?: string }) {
  const text = value && String(value).trim() ? String(value) : "—";
  return (
    <td className={`px-3 py-3 ${className}`} style={{ maxWidth: 0 }}>
      <div className="truncate" title={text}>
        {text}
      </div>
    </td>
  );
}

/** Generic scrollable table: sticky header, only the body region scrolls.
 *  Parent must give this a bounded height via flex (flex-1 min-h-0). */
function ScrollableTable<T>({
  columns,
  rows,
  renderRow,
  emptyLabel = "No records found",
}: {
  columns: { label: string; width?: string }[];
  rows: T[];
  renderRow: (row: T, index: number) => ReactNode;
  emptyLabel?: string;
}) {
  return (
    <div
      className="sw-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded"
      style={{ border: `1px solid ${C.border}` }}
    >
      <table className="w-full border-collapse text-xs" style={{ tableLayout: "fixed" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 1, background: C.panelSoft }}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.label}
                className="whitespace-nowrap px-3 py-3 text-left font-medium"
                style={{ color: C.dim, width: col.width, borderBottom: `1px solid ${C.border}` }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center" style={{ color: C.dim }}>
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => renderRow(row, idx))
          )}
        </tbody>
      </table>
    </div>
  );
}

const TABS = ["Daily Log"] as const;
type Tab = (typeof TABS)[number];

/* ------------------------------------------------------------------ */
/* Filter logic                                                        */
/* ------------------------------------------------------------------ */
// Today's date in the user's LOCAL timezone, as yyyy-mm-dd.
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function daysBetween(a: string, b: string) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}

function matchesPeriod(date: string, period: Period, today: string): boolean {
  if (period === "all") return true;
  const diff = daysBetween(today, date); // >=0 for past dates
  if (period === "daily") return diff === 0;
  if (period === "weekly") return diff >= 0 && diff <= 6;
  if (period === "monthly") return diff >= 0 && diff <= 29;
  return true;
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export default function Reports() {
  const [activeTab] = useState<Tab>("Daily Log");
  const [period, setPeriod] = useState<Period>("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [operatorFilter, setOperatorFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [ticketRecord, setTicketRecord] = useState<Weighing[]>([]);

  // printing
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWeighings()
      .then((result: Weighing[]) => {
        if (!cancelled) setTicketRecord(result);
      })
      .catch((err: unknown) => console.error("Failed to load weighings:", err));
    return () => {
      cancelled = true;
    };
  }, []); // fetch once on mount

  useEffect(() => {
    getPrinterSettings().then(setPrinterSettings).catch(console.error);
  }, []);

  const vehicleOptions = useMemo(
    () => ["all", ...Array.from(new Set(ticketRecord.map((w) => w.vehicleId)))],
    [ticketRecord]
  );
  const companyOptions = useMemo(
    () => ["all", ...Array.from(new Set(ticketRecord.map((w) => w.company)))],
    [ticketRecord]
  );
  const operatorOptions = useMemo(
    () => ["all", ...Array.from(new Set(ticketRecord.map((w) => w.operator)))],
    [ticketRecord]
  );

  const filteredWeighings = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const today = todayLocal();
    return ticketRecord.filter((w) => {
      if (!matchesPeriod(w.date, period, today)) return false;
      if (vehicleFilter !== "all" && w.vehicleId !== vehicleFilter) return false;
      if (companyFilter !== "all" && w.company !== companyFilter) return false;
      if (operatorFilter !== "all" && w.operator !== operatorFilter) return false;
      if (q) {
        const haystack =
          `${w.ticketNumber} ${w.vehicleId} ${w.company} ${w.material} ${w.destination} ${w.operator} ${w.driver}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [ticketRecord, period, vehicleFilter, companyFilter, operatorFilter, searchText]);

  const handlePrint = async (w: Weighing) => {
    setPrintingId(w.id);
    setPrintError(null);
    try {
      const rows = await ReadTicketByNumber(w.ticketNumber);
      const raw = rows[0];
      if (!raw) {
        setPrintError("Ticket not found.");
        return;
      }

      const ticket = mapTicketRow(raw);
      const [vehicle, operatorName] = await Promise.all([
        ReadVehicleById(ticket.vehicle_id),
        ReadUserById(ticket.user_id),
      ]);

      const html = buildInvoiceHtml(withVehicle(ticket, vehicle), {
        operatorName,
        isDuplicate: MARK_REPRINTS_AS_DUPLICATE,
      });
      await executeSilentHtmlPrint(html);
    } catch (e) {
      console.error("Print failed:", e);
      setPrintError("Print failed — check printer connection.");
      setTimeout(() => setPrintError(null), 4000);
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div
      className="h-svh text-black overflow-hidden font-mono"
      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
    >
      <div className="flex h-screen flex-col gap-4 overflow-hidden">
        {/* Filter bar — drives summary + Daily Log table */}
        <Panel className="p-3" style={{ flexShrink: 0 }}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 pb-1.5 text-xs font-semibold">
              <Filter size={13} /> Filters
            </div>

            <FilterSelect
              label="Period"
              value={period}
              onChange={(v) => setPeriod(v as Period)}
              options={[
                { value: "all", label: "All Time" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
            <FilterSelect
              label="Vehicle"
              value={vehicleFilter}
              onChange={setVehicleFilter}
              options={vehicleOptions.map((v) => ({ value: v, label: v === "all" ? "All Vehicles" : v }))}
            />
            <FilterSelect
              label="Company"
              value={companyFilter}
              onChange={setCompanyFilter}
              options={companyOptions.map((v) => ({ value: v, label: v === "all" ? "All Companies" : v }))}
            />
            <FilterSelect
              label="Operator"
              value={operatorFilter}
              onChange={setOperatorFilter}
              options={operatorOptions.map((v) => ({ value: v, label: v === "all" ? "All Operators" : v }))}
            />

            <label className="ml-auto flex flex-col gap-1 text-xs" style={{ color: C.dim }}>
              Search
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                style={{ background: C.panelSoft, border: `1px solid ${C.border}` }}
              >
                <Search size={13} />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Ticket, vehicle, company, operator..."
                  className="w-56 bg-transparent text-xs outline-none"
                  style={{ color: C.text }}
                />
              </div>
            </label>
          </div>
        </Panel>

        {/* Tab content — bounded, never scrolls itself */}
        <div className="min-h-0 flex-1 overflow-hidden mb-3">
          {activeTab === "Daily Log" && (
            <DailyLogTab
              weighings={filteredWeighings}
              onPrint={handlePrint}
              printingId={printingId}
              printDisabled={!printerSettings?.printerName}
              printError={printError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: C.dim }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg px-3 py-1.5 text-xs"
        style={{ background: C.panelSoft, border: `1px solid ${C.border}` }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Daily weighing log (respects top filter bar)                   */
/* ------------------------------------------------------------------ */
function SummaryItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px]" style={{ color: C.dim }}>
        {label}
      </span>
      <span className="text-sm font-bold" style={{ color: color ?? C.text }}>
        {value}
      </span>
    </div>
  );
}

function DailyLogTab({
  weighings,
  onPrint,
  printingId,
  printDisabled,
  printError,
}: {
  weighings: Weighing[];
  onPrint: (w: Weighing) => void;
  printingId: string | null;
  printDisabled: boolean;
  printError: string | null;
}) {
  const totals = useMemo(() => {
    const overloads = weighings.filter((w) => w.status === "Overload").length;
    return {
      count: weighings.length,
      net: weighings.reduce((sum, w) => sum + (Number(w.net) || 0), 0),
      overloads,
      passed: weighings.length - overloads,
    };
  }, [weighings]);

  return (
    <Panel className="flex h-full flex-col gap-3 p-5">
      {/* Summary of whatever the filters currently show */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-1 rounded px-3 py-2"
        style={{ background: C.panelSoft, border: `1px solid ${C.border}` }}
      >
        <SummaryItem label="Tickets" value={totals.count.toLocaleString()} />
        <SummaryItem label="Total Net" value={`${totals.net.toLocaleString()} kg`} />
        <SummaryItem label="Passed" value={totals.passed.toLocaleString()} color={C.green} />
        <SummaryItem
          label="Overloads"
          value={totals.overloads.toLocaleString()}
          color={totals.overloads > 0 ? C.red : C.text}
        />
        {printError && (
          <span className="ml-auto text-xs font-semibold" style={{ color: C.red }}>
            {printError}
          </span>
        )}
        {!printError && printDisabled && (
          <span className="ml-auto text-[11px]" style={{ color: C.orange }}>
            No printer configured — set one in Settings to enable printing.
          </span>
        )}
      </div>

      <ScrollableTable<Weighing>
        columns={[
          { label: "Ticket No", width: "150px" },
          { label: "Date", width: "100px" },
          { label: "Vehicle", width: "100px" },
          { label: "Tare", width: "75px" },
          { label: "Gross", width: "75px" },
          { label: "Net", width: "85px" },
          { label: "Limit", width: "75px" },
          { label: "Status", width: "90px" },
          { label: "Print", width: "55px" },
        ]}
        rows={weighings}
        renderRow={(w) => {
          const isPrinting = printingId === w.id;
          return (
            <tr key={w.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <TextCell value={w.ticketNumber} className="font-semibold" />
              <td className="px-3 py-3 whitespace-nowrap leading-tight">
                <div>{w.date}</div>
                <div className="text-[10px]" style={{ color: C.slate }}>
                  {w.time}
                </div>
              </td>
              <TextCell value={w.vehicleId} className="font-semibold" />
              <td className="px-3 py-3">{w.tare.toLocaleString()}</td>
              <td className="px-3 py-3">{w.gross.toLocaleString()}</td>
              <td className="px-3 py-3 font-semibold">{w.net.toLocaleString()}</td>
              <td className="px-3 py-3">{w.limit ? w.limit.toLocaleString() : "—"}</td>
              <td className="px-3 py-3">
                <StatusPill w={w} />
              </td>
              <td className="px-3 py-3">
                <button
                  type="button"
                  onClick={() => onPrint(w)}
                  disabled={printDisabled || isPrinting || printingId !== null}
                  title={
                    printDisabled
                      ? "No printer configured"
                      : isPrinting
                      ? "Printing…"
                      : `Print ticket ${w.ticketNumber}`
                  }
                  className="rounded p-1.5 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: C.dim }}
                >
                  {isPrinting ? <span className="text-[10px]">…</span> : <Printer size={15} />}
                </button>
              </td>
            </tr>
          );
        }}
      />
    </Panel>
  );
}

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Search, Filter } from "lucide-react";
import {fetchWeighings} from "../services/database";
/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#ffffff",
  panel: "#ffffff",
  panelSoft: "#eff6ff",   // tailwind blue-50, for input/select backgrounds
  border: "#bfdbfe",      // tailwind blue-200
  text: "#000000",
  dim: "#1e3a8a",         // dark blue for secondary/dim text (readable on white)
  green: "#16a34a",
  orange: "#ea580c",
  amber: "#d97706",
  blue: "#93c5fd",        // blue-300
  cyan: "#0891b2",
  red: "#dc2626",
  slate: "#475569",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Weighing = {
  id: string;
  vehicleId: string;
  company: string;
  tare: number;
  gross: number;
  net: number;
  limit: number;
  operator: string;
  driver: string;
  date: string; // ISO yyyy-mm-dd
  time: string; // HH:mm
  status: "Pass" | "Overload";
};



type Period = "all" | "daily" | "weekly" | "monthly";

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */
// Reference "today" for the daily/weekly/monthly filters below.
const TODAY = "2026-09-03";


/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
function Panel({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-xl ${className}`} style={{  ...style }}>
      {children}
    </div>
  );
}



function StatusPill({ status }: { status: Weighing["status"] }) {
  const c = status === "Pass" ? C.green : C.red;
  return (
    <span className="inline-flex rounded-md px-2 py-1 text-xs font-semibold" style={{ color: c }}>
      {status}
    </span>
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
    <div className="sw-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden  rounded" style={{ border: `1px solid ${C.border}` }}>
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
function daysBetween(a: string, b: string) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}

function matchesPeriod(date: string, period: Period): boolean {
  if (period === "all") return true;
  const diff = daysBetween(TODAY, date); // >=0 for past dates
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
 

  useEffect(() => {
    let cancelled = false;
    fetchWeighings()
      .then((result) => {
        if (!cancelled) setTicketRecord(result);
      })
      .catch((err) => console.error("Failed to load weighings:", err))
      .finally(() => {
        //
      });
    return () => { cancelled = true; };
  }, []); // empty deps = fetch once on mount

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
    return ticketRecord.filter((w) => {
      if (!matchesPeriod(w.date, period)) return false;
      if (vehicleFilter !== "all" && w.vehicleId !== vehicleFilter) return false;
      if (companyFilter !== "all" && w.company !== companyFilter) return false;
      if (operatorFilter !== "all" && w.operator !== operatorFilter) return false;
      if (q) {
        const haystack = `${w.vehicleId} ${w.company} ${w.operator} ${w.driver} ${w.id}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [ticketRecord, period, vehicleFilter, companyFilter, operatorFilter, searchText]);


  return (
    <div className="h-svh text-black  overflow-hidden font-mono" style={{  fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
      

      <div className="flex h-screen flex-col gap-4 overflow-hidden ">
        {/* Filter bar — drives stat cards + Daily Log table */}
        <Panel className="p-3" style={{ flexShrink: 0 }}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 pb-1.5 text-xs font-semibold" >
              <Filter size={13} /> Filters
            </div>

            <FilterSelect label="Period" value={period} onChange={(v) => setPeriod(v as Period)}
              options={[
                { value: "all", label: "All Time" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
            <FilterSelect label="Vehicle" value={vehicleFilter} onChange={setVehicleFilter}
              options={vehicleOptions.map((v) => ({ value: v, label: v === "all" ? "All Vehicles" : v }))}
            />
            <FilterSelect label="Company" value={companyFilter} onChange={setCompanyFilter}
              options={companyOptions.map((v) => ({ value: v, label: v === "all" ? "All Companies" : v }))}
            />
            <FilterSelect label="Operator" value={operatorFilter} onChange={setOperatorFilter}
              options={operatorOptions.map((v) => ({ value: v, label: v === "all" ? "All Operators" : v }))}
            />

            <label className="ml-auto flex flex-col gap-1 text-xs" style={{ color: C.dim }}>
              Search
              <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: C.panelSoft, border: `1px solid ${C.border}` }}>
                <Search size={13} />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Vehicle, company, operator..."
                  className="w-48 bg-transparent text-xs outline-none"
                  style={{ color: C.text }}
                />
              </div>
            </label>
          </div>
        </Panel>

    

        {/* Tab content — bounded, never scrolls itself */}
        <div className="min-h-0 flex-1 overflow-hidden mb-3">
          {activeTab === "Daily Log" && <DailyLogTab weighings={filteredWeighings} />}
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
        style={{ background: C.panelSoft, border: `1px solid ${C.border}`,  }}
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
function DailyLogTab({ weighings }: { weighings: Weighing[] }) {
  return (
    <Panel className="flex h-full flex-col p-5">

        <ScrollableTable<Weighing>
          columns={[
            
            { label: "Vehicle", width: "110px" },
            { label: "Company" },
            { label: "Tare", width: "70px" },
            { label: "Gross", width: "70px" },
            { label: "Net", width: "90px" },
            { label: "Operator" },
            { label: "Driver" },
            { label: "Date", width: "70px" },
            { label: "Status", width: "90px" },
          ]}
          rows={weighings}
          renderRow={(w) => (
            <tr key={w.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td className="px-3 py-3 font-semibold">{w.vehicleId}</td>
              <td className="px-3 py-3" >{w.company}</td>
              <td className="px-3 py-3">{w.tare.toLocaleString()}</td>
              <td className="px-3 py-3">{w.gross.toLocaleString()}</td>
              <td className="px-3 py-3">{w.net.toLocaleString()}</td>
              <td className="px-3 py-3" >{w.operator}</td>
              <td className="px-3 py-3" >{w.driver}</td>
              <td
                className="px-3 py-3 whitespace-nowrap overflow-hidden text-ellipsis"
                style={{ maxWidth: 0 }} // needed for text-ellipsis to work inside a fixed-width table cell
              >{w.date}</td>
              <td className="px-3 py-3"><StatusPill status={w.status} /></td>
            </tr>
          )}
        />
    
    </Panel>
  );
}



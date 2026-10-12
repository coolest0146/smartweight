import { useEffect, useMemo, useRef, useState } from "react";
import { ReadVehicles, VehicleRecords, UpdatedVehicleTareWeight, CreateVehicle } from "../services/vehicles";
import { createTicketRecord, TicketRecord, ReadTicket, ReadTicketByNumber } from "../services/database";
import { useSerialConnection } from "../context/SerialConnectionContext";
import { invoke } from "@tauri-apps/api/core";
import { PrinterIcon, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { executeSilentHtmlPrint } from "../services/printer";
import { PrinterSettings, getPrinterSettings, buildInvoiceHtml } from "../services/PrinterSetting";
import {
  listEntries,MasterEntry
} from "../services/masterData";

// ---------------------------------------------------------------------
// MOCK DATA — Party/Commodity/Charges have no backing tables yet, so
// these stay as local constants until parties/commodities tables and a
// TicketRecord.charges column exist.
// ---------------------------------------------------------------------

const MOCK_PARTIES:string[] = [];

const MOCK_COMMODITIES:string[]=[];

const TRUCK_TYPES:string[] = [
  "2-Axle Rigid",
  "3-Axle Rigid",
  "4-Axle Semi-Trailer",
  "6-Axle Interlink",
];

const BLANK_FORM = {
  plate_number: "",
  party_name: "",
  transporter: "",
  truck_type: "",
  driver_name: "",
  driver_license: "",
  commodity: "",
  max_permissible_weight: "",
  destination: "",
  charges: "",
};

// A labeled row: "Label :" on the left, control on the right — mirrors
// the legacy screenshot's field alignment throughout.
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <label className="text-[13px] text-blue-900 font-semibold">{label} :</label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded border border-blue-500 bg-white px-2 py-1 text-[13px] text-black outline-none focus:border-orange-500";

// ---------------------------------------------------------------------
// Ticket preview panel — renders buildInvoiceHtml() output at true
// physical paper width (mm), so what you see is what the OS print API
// will actually produce. Reused for both live drafts and saved tickets.
// ---------------------------------------------------------------------



export function TicketPreviewPanel({
  html,
  onPrint,
  printing,
  printDisabled,
  printError,
}: {
  html: string | null;
  onPrint: () => void;
  printing: boolean;
  printDisabled: boolean;
  printError: string | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Exact A4 dimensions in millimeters
  const widthMm = 210;
  const heightMm = 297;

  // Convert mm dimensions to operational pixels (~3.78px per mm)
  const a4WidthPx = widthMm * 3.779528;
  const a4HeightPx = heightMm * 3.779528;

  // Fit-to-window: ResizeObserver on the viewport div means the ticket is
  // re-fitted whenever the panel itself changes size (window resize, panel
  // resize, layout shifts) — not just on window resize — so the A4 sheet can
  // never overflow the preview window.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const fit = () => {
      const maxAllowedWidth = viewport.clientWidth - 16;
      const maxAllowedHeight = viewport.clientHeight - 16;
      if (maxAllowedWidth <= 0 || maxAllowedHeight <= 0) return;

      const scaleX = maxAllowedWidth / a4WidthPx;
      const scaleY = maxAllowedHeight / a4HeightPx;
      const perfectScale = Math.min(scaleX, scaleY, 1);

      setScale(perfectScale > 0 ? perfectScale : 0.1);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [a4WidthPx, a4HeightPx, html]);

  // buildInvoiceHtml() returns a complete, self-contained <!doctype html>
  // document. Write it straight into the iframe instead of nesting it inside
  // another document's <div>.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(
      html ??
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              html, body {
                margin: 0;
                padding: 0;
                width: ${widthMm}mm;
                height: ${heightMm}mm;
                font-family: sans-serif;
                color: #888;
              }
              .empty-state {
                text-align: center;
                padding-top: 100mm;
                font-size: 4mm;
              }
            </style>
          </head>
          <body>
            <div class="empty-state">Fill in ticket fields to view page layout.</div>
          </body>
        </html>`,
    );
    doc.close();

    iframe.style.height = `${a4HeightPx}px`;
  }, [html, a4HeightPx]);

  return (
    <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col gap-2 overflow-hidden rounded border border-blue-500 bg-blue-200 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-blue-900">
          Ticket Preview <span className="font-normal text-blue-700">(Fit Page Window)</span>
        </span>
        <button
          type="button"
          onClick={onPrint}
          disabled={printDisabled || printing}
          className="flex shrink-0 items-center gap-1.5 rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PrinterIcon className="h-3.5 w-3.5" />
          {printing ? "Printing…" : "Print"}
        </button>
      </div>

      {printError && <span className="shrink-0 text-[11px] text-red-600">{printError}</span>}

      <div
        ref={viewportRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded bg-slate-300 p-2"
      >
        <div
          style={{
            width: `${a4WidthPx}px`,
            height: `${a4HeightPx}px`,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            background: "#fff",
            boxShadow: "0 0 12px rgba(0,0,0,0.3)",
            flexShrink: 0,
          }}
        >
          <iframe
            ref={iframeRef}
            title="ticket-preview"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          />
        </div>
      </div>
    </div>
  );
}


export default function SlipEntryLayout() {
  const navigate = useNavigate();
  const { status, reading, error, startReading } = useSerialConnection();

  const [mode, setMode] = useState<"first" | "second">("first");
  const [autoTicket, setAutoTicket] = useState(true);
  const [ticketNo] = useState("TCK-4821");

  const [form, setForm] = useState(BLANK_FORM);
  const [plateQuery, setPlateQuery] = useState("");
  const [showMatches, setShowMatches] = useState(false);
  const [matchNote, setMatchNote] = useState("");

  const [vehicles, setVehicles] = useState<VehicleRecords[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | undefined>(undefined);

  const [saveMessage, setSaveMessage] = useState("");
  const [lastTicketNo, setLastTicketNo] = useState("—");

  //Printer related setting
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  // Live capture — only used when the selected vehicle's tare is unknown.
  const [displayMode, setDisplayMode] = useState<"gross" | "tare">("gross");
  const [capturedGross, setCapturedGross] = useState<number | null>(null);
  const [capturedTare, setCapturedTare] = useState<number | null>(null);

  const updateField = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const resetToBlank = () => {
    setForm(BLANK_FORM);
    setPlateQuery("");
    setShowMatches(false);
    setMatchNote("");
    setSaveMessage("");
    setSelectedVehicleId(undefined);
  };

  const handleFirst = () => {
    resetToBlank();
    setMode("first");
  };

  const handleSecond = () => {
    resetToBlank();
    setMode("second");
  };

  // Load the vehicle list once on mount.
  useEffect(() => {
    const readvehicles = async () => {
      try {
        const result: VehicleRecords[] = await ReadVehicles();
        setVehicles(result);
      } catch (err) {
        console.error("Failed to load vehicles:", err);
      }
    };
    readvehicles();
  }, []);

  const filteredVehicles = plateQuery.trim()
    ? vehicles.filter((v) => v.plate_number.toLowerCase().includes(plateQuery.toLowerCase()))
    : vehicles;

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  const handleSelectVehicle = (vehicle: VehicleRecords) => {
    setSelectedVehicleId(vehicle.id);
    setForm({
      plate_number: vehicle.plate_number,
      party_name: vehicle.transporter || "",
      transporter: vehicle.transporter,
      truck_type: vehicle.truck_type,
      driver_name: vehicle.driver_name,
      driver_license: vehicle.driver_license,
      commodity: "",
      max_permissible_weight: vehicle.max_permissible_weight ? String(vehicle.max_permissible_weight) : "",
      destination: "",
      charges: "",
    });
    setPlateQuery(vehicle.plate_number);
    setShowMatches(false);

    const missing: string[] = [];
    if (!vehicle.transporter) missing.push("transporter");
    if (!vehicle.truck_type) missing.push("truck type");
    if (!vehicle.driver_name) missing.push("driver name");
    if (!vehicle.driver_license) missing.push("driver license");
    if (!vehicle.tare_weight) missing.push("tare weight");

    setMatchNote(
      missing.length === 0
        ? "Full record found."
        : `Partial record — missing: ${missing.join(", ")}.`
    );
  };

  // Reset live captures whenever the selected vehicle changes, so a
  // leftover capture from a previous truck never leaks into a new ticket.
  useEffect(() => {
    setCapturedGross(null);
    setCapturedTare(null);
    setDisplayMode("gross");
  }, [selectedVehicleId]);

  const tareKnown = Boolean(selectedVehicle?.tare_weight);

  const handleCaptureReading = () => {
    if (reading === null) return;
    if (displayMode === "gross") setCapturedGross(reading.weight);
    else setCapturedTare(reading.weight);
  };

  // What Save should actually use for gross/tare, whichever path we're on.
  const effectiveGross = capturedGross||0;
  const effectiveTare = tareKnown ? selectedVehicle?.tare_weight ?? 0 : capturedTare ?? 0;
  const effectiveNet = effectiveGross ? effectiveGross-effectiveTare:0;

  const isOverweight =
    selectedVehicle?.max_permissible_weight != null &&
    effectiveGross > selectedVehicle.max_permissible_weight;

  // Can't save an unknown-tare ticket until both readings are actually in.
  const readyToSave = status === "connected" ? true : false;



  async function handleRefreshPorts() {
    try {
      await invoke<string[]>("refresh_serial_ports");
    } catch (e) {
      console.error("Failed to refresh ports:", e);
    }
  }

  let currentUser: { fullName?: string; role?: string; id: number } | null = null;
  try {
    currentUser = JSON.parse(localStorage.getItem("currentUser") || "null") as
      | { fullName?: string; role?: string; id: number }
      | null;
  } catch {
    currentUser = null;
  }
  let vehicle_id_setted:number;
  const handleSave = async () => {
    if (!currentUser?.id) {
      setSaveMessage("No logged-in user found — cannot create ticket.");
      return;
    }
    if (!readyToSave) {
      setSaveMessage(
        tareKnown ? "Select a vehicle first." : "Capture both Gross and Tare before saving."
      );
      return;
    }
  
    if (selectedVehicleId === undefined) {
      const current_vehicle_id = await CreateVehicle(
        form.plate_number,
        form.transporter,
        form.truck_type,
        Number(form.max_permissible_weight),
        effectiveTare,
        form.driver_name,
        form.driver_license,
        form.commodity || "",
        form.destination || ""
      );
      setSelectedVehicleId(current_vehicle_id);
      const result: VehicleRecords[] = await ReadVehicles();
      setVehicles(result);
      vehicle_id_setted=current_vehicle_id
    }

    if (selectedVehicleId !== undefined && !selectedVehicle?.tare_weight) {

      await UpdatedVehicleTareWeight(selectedVehicleId, effectiveTare);
      setVehicles((prev) =>
        prev.map((v) => (v.id === selectedVehicleId ? { ...v, tare_weight: effectiveTare } : v))
      );

      const result: VehicleRecords[] = await ReadVehicles();
      setVehicles(result);

    
    }

    const ticketNumber = autoTicket ? `TICKET-${Date.now()}` : ticketNo;

    const record: TicketRecord = {
      vehicle_id: vehicle_id_setted ||selectedVehicleId|| 0,
      user_id: currentUser.id,
      tare_weight: effectiveTare,
      measured_weight: effectiveGross,
      net_weight: effectiveNet,
      max_allowed_weight: selectedVehicle?.max_permissible_weight || 0,
      unit: reading?.unit || "kg",
      status: isOverweight ? "overweight" : "within limit",
      ticket_number: ticketNumber,
      created_at: new Date().toISOString(),
      material: form.commodity || undefined,
      destination: form.destination || undefined,
    };

    
    try {
      console.log(selectedVehicleId)
      console.log(record)
      await createTicketRecord(record);
      
      // First time we've learned this vehicle's tare — write it back so
      // future visits skip the manual capture entirely.
      if (!tareKnown && selectedVehicleId !== undefined && capturedTare !== null) {
        await UpdatedVehicleTareWeight(selectedVehicleId, capturedTare);
        setVehicles((prev) =>
          prev.map((v) => (v.id === selectedVehicleId ? { ...v, tare_weight: capturedTare } : v))
        );
      }

      await ReadTicket();
      setLastTicketNo(ticketNumber);
      setSaveMessage("Ticket saved.");
     
    } catch (err) {
      console.error("Failed to save ticket:", err);
      setSaveMessage("Failed to save ticket.");
    }
  };

  //move to setting
  const handlesetting = () => {
    navigate("/setting", { replace: true });
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("activeOperatorId");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("currentUser");
    navigate("/", { replace: true });
  };

  useEffect(() => {
    getPrinterSettings().then(setPrinterSettings).catch(console.error);
  }, []);

  const draftTicket = useMemo(() => {
    const hasAnyInput =
      form.plate_number || plateQuery || selectedVehicle || form.party_name || form.transporter;
    if (!hasAnyInput) return null;

    return {
      ticket_number:(autoTicket ? (lastTicketNo !== "—" ? lastTicketNo : "PREVIEW") : ticketNo) || "PREVIEW",
      vehicle_id: selectedVehicleId || 0,
      plate_number: form.plate_number || plateQuery || "",
      party_name: form.party_name || "",
      transporter: form.transporter || "",
      truck_type: form.truck_type || "",
      driver_name: form.driver_name || "",
      driver_license: form.driver_license || "",
      commodity: form.commodity || "",
      destination: form.destination || "",
      tare_weight: effectiveTare || 0,
      measured_weight: effectiveGross || 0,
      net_weight: effectiveNet || 0,
      max_allowed_weight:selectedVehicle?.max_permissible_weight || Number(form.max_permissible_weight) || 0,
      unit: reading?.unit || "kg",
      status: isOverweight ? "overweight" : "within limit",
      created_at: new Date().toISOString(),
      material: form.commodity || undefined,
    } as any;
  }, [
    form,
    plateQuery,
    selectedVehicle,
    selectedVehicleId,
    effectiveTare,
    effectiveGross,
    effectiveNet,
    reading,
    isOverweight,
    autoTicket,
    ticketNo,
    lastTicketNo,
  ]);

  const previewHtml = useMemo(() => {
    if (!draftTicket) return null;
    try {
      return buildInvoiceHtml(draftTicket);
    } catch (e) {
      console.error("Preview build failed:", e);
      return null;
    }
  }, [draftTicket]);

  const handlePrintTicket = async () => {
    setPrinting(true);
    setPrintError(null);
    try {
      if (lastTicketNo !== "—") {
        const rows = await ReadTicketByNumber(lastTicketNo);
        const ticket = rows[0];

        if (!ticket) {
          setPrintError("Ticket not found.");
          return;
        }

        const html = buildInvoiceHtml(ticket);
        await executeSilentHtmlPrint(html);
      } else {
        setPrintError("Save the ticket before printing.");
      }
    } catch (e) {
      console.error("Print failed:", e);
      setPrintError("Print failed — check printer connection.");
      setTimeout(() => setPrintError(null), 4000);
    } finally {
      setPrinting(false);
    }
  };

  

 

  const SCALE_SETTINGS_KEY = "scale-settings";
 
  const [port] = useState(() => {
      try {
          const saved = localStorage.getItem(SCALE_SETTINGS_KEY);
          return saved ? JSON.parse(saved).selectedSerialPort : "";
        } catch { return ""; }
  });

  const [baud] = useState(() => {
      try {
          const saved = localStorage.getItem(SCALE_SETTINGS_KEY);
          return saved ? JSON.parse(saved).baudRate : "";
        } catch { return ""; }
  });
 
  useEffect(() => {
    party_names();
    commodities();
    truck();
  }, [port]);

  const handleConnect = () => {
    startReading(port, baud);
  };

 //COMMODITIES AND TRUCKTYPE AND COMPANY
const truck=async ()=>{
      const parties:MasterEntry[]= await listEntries("truck_types");
    for (const party of parties){
      if(!TRUCK_TYPES.includes(party.value)){
          TRUCK_TYPES.push(party.value);
      }
    }
}

const commodities=async ()=>{
    const parties:MasterEntry[]= await listEntries("commodities");
    for (const party of parties){
      if(!MOCK_COMMODITIES.includes(party.value)){
          MOCK_COMMODITIES.push(party.value);
      }
    }
}

const party_names=async ()=>{
    const parties:MasterEntry[]= await listEntries("party_names");
    for (const party of parties){
      if(!MOCK_PARTIES.includes(party.value)){
          MOCK_PARTIES.push(party.value);
      }
    }
}
  

  return (
    <div className="h-screen w-screen bg-blue-100 flex items-center justify-center p-3 font-mono overflow-hidden">
      <div className="w-full h-full max-w-350 overflow-hidden flex flex-col">
        {/* Body — three panels side by side, filling all remaining height */}
        <div className="flex-1 flex gap-3 p-3 min-h-0">
          {/* LEFT PANEL — weight capture + First/Second */}
          <div className="w-87.5 shrink-0 bg-blue-200 border border-blue-500 rounded p-3 flex flex-col gap-2.5 overflow-y-auto">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1 text-[13px] text-slate-900">
                <input
                  type="radio"
                  checked={displayMode === "gross"}
                  onChange={() => setDisplayMode("gross")}
                />
                Gross
              </label>
              <label className="flex items-center gap-1 text-[13px] text-slate-900">
                <input
                  type="radio"
                  checked={displayMode === "tare"}
                  onChange={() => setDisplayMode("tare")}
                />
                Tare
              </label>
              <button
                onClick={handleCaptureReading}
                disabled={reading === null}
                className="rounded font-inter bg-white px-2.5 py-1 text-xs font-semibold text-black border border-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                Select
              </button>
            </div>

            {/* LED-style display — live reading */}
            <div className="bg-black rounded px-4 py-4 text-right">
              <span className="text-red-600 digital-clock font-bold text-6xl tracking-widest">
                {status === "connected" && reading !== null ? reading.weight : "0"}
              </span>
            </div>

            <div className="space-y-1.5">
              <FieldRow label="Gross Wt">
                <input
                  readOnly
              
                    value={
                      status === "connected" && capturedGross !== null && displayMode === "gross"
                        ? capturedGross : 0
                    }
                    className={inputClass}
           
                />
              </FieldRow>
              <FieldRow label="Tare Wt">
                <input
                  readOnly
                  value={
                    displayMode === "tare"
                      ? (capturedTare ?? 0)
                      : selectedVehicleId !== null
                        ? (selectedVehicle?.tare_weight ?? 0)
                        : 0
                  }
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Net Wt">
                <input
                  readOnly
                  value={selectedVehicle && readyToSave ? effectiveNet : ""}
                  className={inputClass}
                />
              </FieldRow>
            </div>

            {!tareKnown && selectedVehicle && (
              <p className="text-[11px] text-orange-600">
                {capturedGross === null
                  ? "Weigh the loaded truck, select Gross, then Select."
                  : capturedTare === null
                  ? "Truck returned empty? Select Tare, then Select."
                  : "Both readings captured — tare will be saved to this vehicle's profile."}
              </p>
            )}

            {isOverweight && (
              <p className="text-[11px] text-red-600 font-bold">
                Over capacity by{" "}
                {(effectiveGross - (selectedVehicle?.max_permissible_weight || 0)).toFixed(0)} kg
              </p>
            )}

            <div className="space-y-1.5 border-t border-blue-400 pt-2">
              <FieldRow label="Gr. Date">
                <div className="flex gap-1">
                  <input type="date" className={inputClass} />
                </div>
              </FieldRow>
              <FieldRow label="Tr. Date">
                <div className="flex gap-1">
                  <input type="date" className={inputClass} />
                </div>
              </FieldRow>
            </div>

            <div className="flex-1" />

            {/* First / Second — same position as the legacy dialog */}
            <div className="flex gap-2 pt-2 border-t border-blue-400">
              <button
                onClick={handleFirst}
                className={`flex-1 rounded px-3 py-2 text-xs font-bold uppercase border ${
                  mode === "first"
                    ? "bg-white text-black border-slate-500"
                    : "bg-blue-100 text-slate-600 border-blue-400"
                }`}
              >
                First
              </button>
              <button
                onClick={handleSecond}
                className={`flex-1 rounded px-3 py-2 text-xs font-bold uppercase border ${
                  mode === "second"
                    ? "bg-orange-500 text-white border-orange-600"
                    : "bg-blue-100 text-slate-600 border-blue-400"
                }`}
              >
                Second
              </button>
            </div>
            <p className="text-[11px] text-slate-700 leading-snug">
              {mode === "first"
                ? "New vehicle — no record on file. Fill in what you know."
                : "Existing vehicle — search the plate to load its record."}
            </p>
          </div>

          {/* MIDDLE PANEL — field list, label-left / input-right like the reference */}
          <div className="flex-1 bg-blue-200 border border-blue-500 rounded p-3 flex flex-col gap-2 overflow-y-auto">
            <FieldRow label="Ticket No">
              <div className="flex items-center gap-2">
                <input value={ticketNo} readOnly={autoTicket} className={inputClass} />
                <label className="flex items-center gap-1 text-[11px] text-slate-900 whitespace-nowrap">
                  <input type="radio" checked={autoTicket} onChange={() => setAutoTicket(true)} />
                  Auto
                </label>
                <label className="flex items-center gap-1 text-[11px] text-slate-900 whitespace-nowrap">
                  <input type="radio" checked={!autoTicket} onChange={() => setAutoTicket(false)} />
                  Manual
                </label>
              </div>
            </FieldRow>

            <FieldRow label="Party Name">
              <select
                value={form.party_name}
                onChange={(e) => updateField("party_name", e.target.value)}
                className={inputClass}
              >
                <option value="">Select party...</option>
                {MOCK_PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Vehicle No">
              {mode === "first" ? (
                <input
                  type="text"
                  value={form.plate_number}
                  onChange={(e) => updateField("plate_number", e.target.value.toUpperCase())}
                  placeholder="Plate number"
                  className={`${inputClass} uppercase`}
                />
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={plateQuery}
                    onChange={(e) => {
                      setPlateQuery(e.target.value);
                      setShowMatches(true);
                    }}
                    onFocus={() => setShowMatches(true)}
                    placeholder="Search plate number..."
                    className={inputClass}
                  />
                  {showMatches && (
                    <div className="absolute z-10 w-full mt-1 max-h-32 overflow-y-auto rounded border border-blue-700 bg-white shadow-lg">
                      {filteredVehicles.length > 0 ? (
                        filteredVehicles.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onMouseDown={() => handleSelectVehicle(v)}
                            className="w-full text-left px-3 py-1.5 text-[13px] text-black hover:bg-blue-100 border-b border-blue-100 last:border-b-0"
                          >
                            <span className="font-semibold">{v.plate_number}</span>
                            {v.transporter ? (
                              <span className="text-slate-600"> — {v.transporter}</span>
                            ) : (
                              <span className="text-orange-500"> (little data on file)</span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-1.5 text-[13px] text-slate-500">No matches.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </FieldRow>
            {matchNote && (
              <p className="text-[11px] text-orange-600 font-semibold -mt-1 ml-29.5">{matchNote}</p>
            )}

            <FieldRow label="Commodity">
              <select
                value={form.commodity}
                onChange={(e) => updateField("commodity", e.target.value)}
                className={inputClass}
              >
                <option value="">Select commodity...</option>
                {MOCK_COMMODITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Charges">
              <input
                type="number"
                value={form.charges}
                onChange={(e) => updateField("charges", e.target.value)}
                className={inputClass}
              />
            </FieldRow>

            <div className="border-t border-blue-400 pt-2 space-y-2">
              <FieldRow label="Transporter">
                <input
                  type="text"
                  value={form.transporter}
                  onChange={(e) => updateField("transporter", e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Truck Type">
                <select
                  value={form.truck_type}
                  onChange={(e) => updateField("truck_type", e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select type...</option>
                  {TRUCK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label="Driver Name">
                <input
                  type="text"
                  value={form.driver_name}
                  onChange={(e) => updateField("driver_name", e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Driver Lic.">
                <input
                  type="text"
                  value={form.driver_license}
                  onChange={(e) => updateField("driver_license", e.target.value.toUpperCase())}
                  className={`${inputClass} uppercase`}
                />
              </FieldRow>
              <FieldRow label="Max Permissible Wt">
                <input
                  type="number"
                  value={form.max_permissible_weight}
                  onChange={(e) => updateField("max_permissible_weight", e.target.value)}
                  placeholder="Max Permissible Weight"
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Destination">
                <input
                  type="text"
                  value={form.destination}
                  onChange={(e) => updateField("destination", e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
            </div>
          </div>

          {/* RIGHT PANEL — ticket print preview, replaces the camera feed */}
          <TicketPreviewPanel
            html={previewHtml}
          
            onPrint={handlePrintTicket}
            printing={printing}
            printDisabled={!printerSettings?.printerName}
            printError={printError}
          />
        </div>

        {/* Footer bar */}
        <div className="bg-blue-100 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 shrink-0 border-t border-blue-200">
          {/* Left: connection controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={status === "connected" || status === "connecting"}
              onClick={handleConnect}
              className="rounded bg-blue-600 px-3 py-2 font-mono text-[10px] font-semibold uppercase text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "connecting" ? "Connecting…" : status === "connected" ? "Connected" : "Connect"}
            </button>

            <button
              type="button"
              onClick={handleRefreshPorts}
              className="rounded bg-orange-500 px-3 py-2 font-mono text-[10px] font-semibold uppercase text-white transition hover:bg-orange-400"
            >
              Refresh
            </button>

            <span
              className={`ml-1 text-xs uppercase font-bold ${
                status === "connected" ? "text-green-600" : "text-red-500"
              }`}
            >
              Com: {status}
            </span>
          </div>

          {/* Center: ticket + messages */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-blue-800">
              Last Ticket No :{" "}
              <span className="text-slate-900 font-semibold">{lastTicketNo}</span>
            </span>
            {saveMessage && <span className="text-xs text-green-700">{saveMessage}</span>}
            {error && <span className="text-xs text-red-600">Serial: {String(error)}</span>}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!readyToSave}
              className="px-5 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-sm font-bold uppercase disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={resetToBlank}
              className="px-5 py-1.5 rounded border border-slate-400 text-slate-700 hover:bg-slate-100 text-sm font-bold uppercase"
            >
              Clear
            </button>
            <button
              onClick={handleLogout}
              className="px-5 py-1.5 rounded border border-slate-400 text-slate-700 hover:bg-slate-100 text-sm font-bold uppercase"
            >
              Logout
            </button>

            <span
              className="text-xs text-blue-800"
              title={printerSettings ? "Configured in Settings" : "No printer configured"}
            >
              {printerSettings?.printerName || "No printer set"}
            </span>

            {/* Settings */}
            <button
              type="button"
              onClick={handlesetting}
              title="Settings"
              className="p-2 rounded hover:bg-blue-200 transition"
            >
              <Settings className="w-5 h-5 text-blue-300" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
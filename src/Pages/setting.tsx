import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { fetchSystemPrinters, type SystemPrinter } from "../services/printer";
import Reports from "./report";
import OperatorPage from "./operatorPage";

import {
  partyNames,
  commodities,
  plateNumbers,
  truckTypes,
  type MasterEntry,
  initMasterDataTables,
} from "../services/masterData";
import {
  Usb,
  Video,
  Printer as PrinterIcon,
  Users,
  Package,
  CarFront,
  Truck,
  Trash2,
  Plus,
  ArrowLeft,
  FileText,
  UsersRound
} from "lucide-react";
import { ensurePrinterSettingsTable, getPrinterSettings, savePrinterSettings } from "../services/PrinterSetting";

const C = {
  bg: "#070d16",
  panel: "#0b1220",
  border: "#16233a",
  text: "#e6edf6",
  dim: "#8b9bb4",
  faint: "#5b6b85",
  green: "#3d85c6",
  orange: "#2986cc",
  red: "#ef4444",
};

/* -------------------------------------------------------------------- */
/*  Shared primitives                                                    */
/* -------------------------------------------------------------------- */

function Panel({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded ${className} bg-blue-200` } style={{ border: `1px solid ${C.border}`, ...style }}>
      {children}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-blue-700 py-3 last:border-b-0">
      <span className="text-xs uppercase tracking-wider text-black">{label}</span>
      <span className="text-sm font-semibold text-black">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.dim }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded border bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-blue-500";

/* -------------------------------------------------------------------- */
/*  Sidebar                                                               */
/* -------------------------------------------------------------------- */

type TabKey = "com" | "camera" | "printer" |"party" | "commodity" | "plate" | "trucktype" | "Report" | "Operator";

const TABS: { key: TabKey; label: string; icon: typeof Usb }[] = [
  { key: "com", label: "COM", icon: Usb },
  { key: "camera", label: "Camera", icon: Video },
  { key: "printer", label: "Printer", icon: PrinterIcon },
  { key: "party", label: "Party Name", icon: Users },
  { key: "commodity", label: "Commodity", icon: Package },
  { key: "plate", label: "Plate Number", icon: CarFront },
  { key: "trucktype", label: "Truck Type", icon: Truck },
  { key: "Report", label: "Report", icon: FileText },
  { key: "Operator", label: "Operator", icon:UsersRound },
];

function Sidebar({ active, onSelect }: { active: TabKey; onSelect: (k: TabKey) => void }) {
  const navigate = useNavigate();

  return (
    <aside
      className="flex w-56 shrink-0 bg-blue-100 flex-col gap-1 border-r p-3"
      style={{borderColor: C.border }}
    >
      <button
        type="button"
        onClick={() => navigate("/dashboard")}
        className="mb-3 flex items-center gap-2  border px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition hover:bg-blue-400"
        style={{ borderColor: C.border, color: C.dim }}
      >
        <ArrowLeft className="h-4 w-4" style={{ color: C.orange }} />
        Back to Dashboard
      </button>

      <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.faint }}>
        Settings
      </p>
      {TABS.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className="flex items-center gap-3 rounded px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide transition"
            style={{
              background: isActive ? "#6fa8dc" : "transparent",
              color: isActive ? C.text : C.dim,
              borderLeft: isActive ? `3px solid ${C.orange}` : "3px solid transparent",
            }}
          >
            <Icon className="h-4 w-4 shrink-0" style={{ color: isActive ? C.orange : C.faint }} />
            {label}
          </button>
        );
      })}
    </aside>
  );
}

/* -------------------------------------------------------------------- */
/*  COM (scale) settings                                                 */
/* -------------------------------------------------------------------- */

type Serialinfo = { name: string; port_type: string };
type ScaleSettings = {
  selectedSerialPort: string;
  baudRate: number;
  dataBits: number;
  parity: "None" | "Even" | "Odd";
  stopBits: number;
};
const defaultScaleSettings: ScaleSettings = {
  selectedSerialPort: "",
  baudRate: 9600,
  dataBits: 8,
  parity: "None",
  stopBits: 1,
};

function ComSettingsTab() {
  const SCALE_SETTINGS_KEY = "scale-settings";
  const [scaleSettings, setScaleSettings] = useState<ScaleSettings>(defaultScaleSettings);
  const [savedScaleSettings, setSavedScaleSettings] = useState<ScaleSettings | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [serialport, setSerialPort] = useState<Serialinfo[]>([]);

  useEffect(() => {
    const savedScale = localStorage.getItem(SCALE_SETTINGS_KEY);
    if (savedScale) {
      try {
        const parsed: ScaleSettings = JSON.parse(savedScale);
        setScaleSettings(parsed);
        setSavedScaleSettings(parsed);
      } catch (e) {
        console.error("Failed to parse scale settings:", e);
      }
    }
    invoke<Serialinfo[]>("get_serial_ports").then(setSerialPort).catch(console.error);
  }, []);

  const handleSaveSettings = () => {
    localStorage.setItem(SCALE_SETTINGS_KEY, JSON.stringify(scaleSettings));
    setSavedScaleSettings(scaleSettings);
    window.dispatchEvent(new Event("scale-settings-changed"));
    setSettingsMessage("Scale configuration saved successfully.");
    setTimeout(() => setSettingsMessage(null), 3000);
  };

  const serialConfigured = savedScaleSettings !== null && savedScaleSettings.selectedSerialPort !== "";

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
      <Panel className="p-6 bg-blue-200" >
        <div className="space-y-5">
          <Field label="Serial Port">
            <select
              value={scaleSettings.selectedSerialPort}
              onChange={(e) => setScaleSettings({ ...scaleSettings, selectedSerialPort: e.target.value })}
              className={inputClass}
            >
              <option value="">Select serial port</option>
              {serialport.map((port) => (
                <option key={port.name} value={port.name}>
                  {port.name}{port.port_type ? ` — ${port.port_type}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Baud Rate">
              <select
                value={scaleSettings.baudRate}
                onChange={(e) => setScaleSettings({ ...scaleSettings, baudRate: Number(e.target.value) })}
                className={inputClass}
              >
                {[1200, 9600, 19200, 38400, 57600, 115200].map((baud) => (
                  <option key={baud} value={baud}>{baud}</option>
                ))}
              </select>
            </Field>
            <Field label="Data Bits">
              <select
                value={scaleSettings.dataBits}
                onChange={(e) => setScaleSettings({ ...scaleSettings, dataBits: Number(e.target.value) })}
                className={inputClass}
              >
                {[5, 6, 7, 8].map((bits) => (
                  <option key={bits} value={bits}>{bits}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Parity">
              <select
                value={scaleSettings.parity}
                onChange={(e) => setScaleSettings({ ...scaleSettings, parity: e.target.value as ScaleSettings["parity"] })}
                className={inputClass}
              >
                {["None", "Even", "Odd"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Stop Bits">
              <select
                value={scaleSettings.stopBits}
                onChange={(e) => setScaleSettings({ ...scaleSettings, stopBits: Number(e.target.value) })}
                className={inputClass}
              >
                {[1, 2].map((bits) => (
                  <option key={bits} value={bits}>{bits}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t pt-5" style={{ borderColor: C.border }}>
            <button
              onClick={handleSaveSettings}
              className="rounded-lg px-5 py-2.5 text-sm font-bold text-blue-transition hover:brightness-110"
              style={{ background: C.green }}
            >
              Save Scale Configuration
            </button>
            {settingsMessage && <span className="text-xs font-semibold" style={{ color: C.green }}>✓ {settingsMessage}</span>}
          </div>
        </div>
      </Panel>

      <Panel className="px-6 py-3 bg-blue-200">
        <div className="flex items-start justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.orange }}>Current Configuration</p>
          <div
            className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold"
            style={{
              borderColor: serialConfigured ? "#14532d" : "#451a03",
              background: serialConfigured ? "#052e16" : "#1c1005",
              color: serialConfigured ? C.green : C.orange,
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: serialConfigured ? C.green : C.orange }} />
            {serialConfigured ? "CONFIGURED" : "NOT CONFIGURED"}
          </div>
        </div>
        <div className="mt-3">
          <SettingRow label="Port" value={savedScaleSettings?.selectedSerialPort || "Not selected"} />
          <SettingRow label="Baud Rate" value={savedScaleSettings?.baudRate || "-"} />
          <SettingRow label="Data Bits" value={savedScaleSettings?.dataBits || "-"} />
          <SettingRow label="Parity" value={savedScaleSettings?.parity || "-"} />
          <SettingRow label="Stop Bits" value={savedScaleSettings?.stopBits || "-"} />
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Camera settings                                                      */
/* -------------------------------------------------------------------- */

type CameraSettings = { frontCameraUrl: string; rearCameraUrl: string; enabled: boolean };
const defaultCameraSettings: CameraSettings = { frontCameraUrl: "", rearCameraUrl: "", enabled: false };

function CameraSettingsTab() {
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(defaultCameraSettings);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);

  useEffect(() => {
    const savedCamera = localStorage.getItem("camera-settings");
    if (savedCamera) {
      try {
        setCameraSettings(JSON.parse(savedCamera));
      } catch (e) {
        console.error("Failed to parse camera settings:", e);
      }
    }
  }, []);

  const handleSaveCameraSettings = async () => {
    localStorage.setItem("camera-settings", JSON.stringify(cameraSettings));
    try {
      if (cameraSettings.enabled) {
        if (cameraSettings.frontCameraUrl.trim()) {
          await invoke("start_camera_stream", { streamName: "front", url: cameraSettings.frontCameraUrl.trim() });
        }
        if (cameraSettings.rearCameraUrl.trim()) {
          await invoke("start_camera_stream", { streamName: "rear", url: cameraSettings.rearCameraUrl.trim() });
        }
      } else {
        await invoke("stop_camera_stream", { streamName: "front" });
        await invoke("stop_camera_stream", { streamName: "rear" });
      }
    } catch (e) {
      console.error("Failed to toggle CCTV streams:", e);
    }
    setCameraMessage(cameraSettings.enabled ? "CCTV settings saved and live stream start requested." : "CCTV settings saved. Streams are disabled.");
    setTimeout(() => setCameraMessage(null), 3000);
  };

  return (
    <Panel className="p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.orange }}>CCTV / RTSP Camera</p>
          <h3 className="mt-2 text-lg font-semibold" style={{ color: C.text }}>Live weighbridge camera configuration</h3>
        </div>
        <label className="inline-flex text-black items-center gap-2 rounded border px-3 py-1.5 text-xs font-bold uppercase" style={{ borderColor: C.border }}>
          <input
            type="checkbox"
            checked={cameraSettings.enabled}
            onChange={(e) => setCameraSettings({ ...cameraSettings, enabled: e.target.checked })}
            className="h-4 w-4 accent-green-500"
          />
          Enabled
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Front Camera RTSP URL">
          <input
            type="text"
            placeholder="rtsp://192.168.1.50:554/stream"
            value={cameraSettings.frontCameraUrl}
            onChange={(e) => setCameraSettings({ ...cameraSettings, frontCameraUrl: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Rear Camera RTSP URL">
          <input
            type="text"
            placeholder="rtsp://192.168.1.51:554/stream"
            value={cameraSettings.rearCameraUrl}
            onChange={(e) => setCameraSettings({ ...cameraSettings, rearCameraUrl: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          onClick={handleSaveCameraSettings}
          className="rounded-lg px-5 py-2.5 text-sm font-bold text-blue-transition hover:brightness-110"
          style={{ background: C.orange }}
        >
          Save Camera Configuration
        </button>
        {cameraMessage && <span className="text-xs font-semibold" style={{ color: C.green }}>✓ {cameraMessage}</span>}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------- */
/*  Printer settings (still via Rust — not "table data")                 */
/* -------------------------------------------------------------------- */

type PrinterSettings = {
  printerName: string;
  pageSize: "A4" | "A5" | "A6" | "Letter";
  orientation: "Portrait" | "Landscape";
  colorMode: "Color" | "BlackAndWhite";
  copies: number;
  marginTopCm: number;
  marginBottomCm: number;
  marginLeftCm: number;
  marginRightCm: number;
  autoPrintOnSave: boolean;
};

const defaultPrinterSettings: PrinterSettings = {
  printerName: "",
  pageSize: "A4",
  orientation: "Portrait",
  colorMode: "BlackAndWhite",
  copies: 1,
  marginTopCm: 1,
  marginBottomCm: 1,
  marginLeftCm: 1,
  marginRightCm: 1,
  autoPrintOnSave: false,
};

const PAGE_SIZES: PrinterSettings["pageSize"][] = ["A4", "A5", "A6", "Letter"];

function PrinterSettingsTab() {
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [settings, setSettings] = useState<PrinterSettings>(defaultPrinterSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSystemPrinters().then(setPrinters).catch(console.error);
    getPrinterSettings().then((saved) => saved && setSettings(saved)).catch(console.error);
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await savePrinterSettings(settings);
      setMessage("Printer configuration saved.");
    } catch (e) {
      console.error("Failed to save printer settings:", e);
      setError(e instanceof Error ? e.message : "Failed to save printer settings.");
    } finally {
      setLoading(false);
      setTimeout(() => { setMessage(null); setError(null); }, 3000);
    }
  };

  return (
    <Panel className="p-6">
      <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.orange }}>
        Printer Configuration
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Printer">
          <select
            value={settings.printerName}
            onChange={(e) => setSettings({ ...settings, printerName: e.target.value })}
            className={inputClass}
          >
            <option value="">Select printer</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}{p.isDefault ? " (Default)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Page Size (max A4)">
          <select
            value={settings.pageSize}
            onChange={(e) => setSettings({ ...settings, pageSize: e.target.value as PrinterSettings["pageSize"] })}
            className={inputClass}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </Field>

        <Field label="Orientation">
          <select
            value={settings.orientation}
            onChange={(e) => setSettings({ ...settings, orientation: e.target.value as PrinterSettings["orientation"] })}
            className={inputClass}
          >
            <option value="Portrait">Portrait</option>
            <option value="Landscape">Landscape</option>
          </select>
        </Field>

        <Field label="Color Mode">
          <select
            value={settings.colorMode}
            onChange={(e) => setSettings({ ...settings, colorMode: e.target.value as PrinterSettings["colorMode"] })}
            className={inputClass}
          >
            <option value="Color">Colored</option>
            <option value="BlackAndWhite">Black &amp; White</option>
          </select>
        </Field>

        <Field label="Copies">
          <input
            type="number"
            min={1}
            max={10}
            value={settings.copies}
            onChange={(e) => setSettings({ ...settings, copies: Number(e.target.value) })}
            className={inputClass}
          />
        </Field>

        <Field label="Auto-print on Save">
          <label className="flex h-11.5 items-center gap-2  border px-4" style={{ borderColor: C.border }}>
            <input
              type="checkbox"
              checked={settings.autoPrintOnSave}
              onChange={(e) => setSettings({ ...settings, autoPrintOnSave: e.target.checked })}
              className="h-4 w-4 accent-green-500"
            />
            <span className="text-sm" style={{ color: C.text }}>Print ticket automatically after save</span>
          </label>
        </Field>
      </div>

      <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.dim }}>
        Margins (cm)
      </p>
      <div className="grid gap-4 sm:grid-cols-4">
        {(["marginTopCm", "marginBottomCm", "marginLeftCm", "marginRightCm"] as const).map((key) => (
          <Field key={key} label={key.replace("margin", "").replace("Cm", "")}>
            <input
              type="number"
              step={0.5}
              min={0}
              value={settings[key]}
              onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 border-t pt-5" style={{ borderColor: C.border }}>
        <button
          onClick={handleSave}
          disabled={loading}
          className="rounded-lg px-5 py-2.5 text-sm font-bold text-blue-transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: C.green }}
        >
          {loading ? "Saving..." : "Save Printer Configuration"}
        </button>
        {message && <span className="text-xs font-semibold" style={{ color: C.green }}>✓ {message}</span>}
        {error && <span className="text-xs font-semibold" style={{ color: C.red }}>✕ {error}</span>}
      </div>
    </Panel>
  );
}



/* -------------------------------------------------------------------- */
/*  Generic master-data panel — backed by the TS service, not Rust       */
/* -------------------------------------------------------------------- */

type MasterDataService = {
  list: () => Promise<MasterEntry[]>;
  add: (value: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
};

function MasterDataPanel({ title, placeholder, service }: { title: string; placeholder: string; service: MasterDataService }) {
  const [entries, setEntries] = useState<MasterEntry[]>([]);
  const [newValue, setNewValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    service.list().catch((e) => {
      console.error(`Failed to load ${title}:`, e);
      return [];
    }).then(setEntries);
  };

  useEffect(load, [service]);

  const handleAdd = async () => {
    const value = newValue.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      await service.add(value);
      setNewValue("");
      load();
    } catch (e) {
      console.error(`Failed to add ${title}:`, e);
      setError("Failed to add. It may already exist.");
    } finally {
      setLoading(false);
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await service.remove(id);
      load();
    } catch (e) {
      console.error(`Failed to delete ${title} entry:`, e);
    }
  };

  return (
    <Panel className="p-6">
      <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.orange }}>{title}</p>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder={placeholder}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className={inputClass}
        />
        <button
          onClick={handleAdd}
          disabled={loading || !newValue.trim()}
          className="flex shrink-0 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-blue-transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: C.green }}
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold" style={{ color: C.red }}>{error}</p>}

      <div className="mt-5 max-h-[50vh] overflow-y-auto rounded-lg border" style={{ borderColor: C.border }}>
        {entries.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: C.faint }}>No entries yet.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0" style={{ borderColor: C.border }}>
              <span className="text-sm text-black" >{entry.value}</span>
              <button onClick={() => handleDelete(entry.id)} className="rounded p-1.5 transition hover:bg-red-500/10">
                <Trash2 className="h-4 w-4" style={{ color: C.red }} />
              </button>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------- */
/*  Page                                                                  */
/* -------------------------------------------------------------------- */

export default function Setting() {
  const [activeTab, setActiveTab] = useState<TabKey>("com");
  const loadTh=async ()=>{
    await initMasterDataTables();
  await ensurePrinterSettingsTable();
  }

  useEffect(()=>{
    loadTh();
  },[]);
  return (
    <div
      className="flex h-screen font-mono bg-blue-100"
      style={{color: C.text, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
    >
      <Sidebar active={activeTab} onSelect={setActiveTab} />

      <main className="flex-1 overflow-y-hidden p-5 lg:p-7">
        {activeTab === "com" && <ComSettingsTab />}
        {activeTab === "camera" && <CameraSettingsTab />}
        {activeTab === "printer" && <PrinterSettingsTab />}
        
        {activeTab === "party" && (
          <MasterDataPanel title="Party Name" placeholder="e.g. Kilimanjaro Traders Ltd" service={partyNames} />
        )}
        {activeTab === "commodity" && (
          <MasterDataPanel title="Commodity" placeholder="e.g. Cement, Maize, Gravel" service={commodities} />
        )}
        {activeTab === "plate" && (
          <MasterDataPanel title="Plate Number" placeholder="e.g. T123 ABC" service={plateNumbers} />
        )}
        {activeTab === "trucktype" && (
          <MasterDataPanel title="Truck Type" placeholder="e.g. Tri-axle, Semi-trailer" service={truckTypes} />
        )}
        {activeTab === "Report" && <Reports />}
        {activeTab === "Operator" && <OperatorPage/>}
      </main>
    </div>
  );
}
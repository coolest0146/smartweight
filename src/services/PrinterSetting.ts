// src/services/printerSettings.ts
import Database from "@tauri-apps/plugin-sql";

export type PrinterSettings = {
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

const ALLOWED_PAGE_SIZES: PrinterSettings["pageSize"][] = ["A4", "A5", "A6", "Letter"];

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:smartweigh.db");
  return dbPromise;
}

export async function ensurePrinterSettingsTable() {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS printer_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      printer_name TEXT NOT NULL,
      page_size TEXT NOT NULL,
      orientation TEXT NOT NULL,
      color_mode TEXT NOT NULL,
      copies INTEGER NOT NULL,
      margin_top_cm REAL NOT NULL,
      margin_bottom_cm REAL NOT NULL,
      margin_left_cm REAL NOT NULL,
      margin_right_cm REAL NOT NULL,
      auto_print_on_save INTEGER NOT NULL
    )
  `);
}

export async function getPrinterSettings(): Promise<PrinterSettings | null> {
  const db = await getDb();
  const rows = await db.select<any[]>("SELECT * FROM printer_settings WHERE id = 1");
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    printerName: r.printer_name,
    pageSize: r.page_size,
    orientation: r.orientation,
    colorMode: r.color_mode,
    copies: r.copies,
    marginTopCm: r.margin_top_cm,
    marginBottomCm: r.margin_bottom_cm,
    marginLeftCm: r.margin_left_cm,
    marginRightCm: r.margin_right_cm,
    autoPrintOnSave: !!r.auto_print_on_save,
  };
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  if (!ALLOWED_PAGE_SIZES.includes(settings.pageSize)) {
    throw new Error(`Page size '${settings.pageSize}' is not allowed (max A4).`);
  }
  if (settings.copies < 1 || settings.copies > 10) {
    throw new Error("Copies must be between 1 and 10.");
  }

  const db = await getDb();
  await db.execute(
    `INSERT INTO printer_settings (
       id, printer_name, page_size, orientation, color_mode,
       copies, margin_top_cm, margin_bottom_cm, margin_left_cm, margin_right_cm,
       auto_print_on_save
     ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT(id) DO UPDATE SET
       printer_name = excluded.printer_name,
       page_size = excluded.page_size,
       orientation = excluded.orientation,
       color_mode = excluded.color_mode,
       copies = excluded.copies,
       margin_top_cm = excluded.margin_top_cm,
       margin_bottom_cm = excluded.margin_bottom_cm,
       margin_left_cm = excluded.margin_left_cm,
       margin_right_cm = excluded.margin_right_cm,
       auto_print_on_save = excluded.auto_print_on_save`,
    [
      settings.printerName,
      settings.pageSize,
      settings.orientation,
      settings.colorMode,
      settings.copies,
      settings.marginTopCm,
      settings.marginBottomCm,
      settings.marginLeftCm,
      settings.marginRightCm,
      settings.autoPrintOnSave ? 1 : 0,
    ]
  );
}



export type TicketRecord = {
  vehicle_id: number;
  user_id:number
  tare_weight: number;
  max_allowed_weight: number;
  measured_weight: number;
  net_weight:number;
  unit: string;
  status: string;
  ticket_number:string;
  created_at: string;
  material?: string;
  destination?: string;
};

// function formatKg(value: number): string {
//   return value.toLocaleString("en-US");
// }

export function buildInvoiceHtml(ticket: TicketRecord): string {
  const isOverloaded = ticket.measured_weight > ticket.max_allowed_weight;

  // const formatKg = (value: number) => `${value.toLocaleString("en-US")} ${ticket.unit}`;

  const createdDate = new Date(ticket.created_at);
  const dateStr = createdDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = createdDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Weighbridge Ticket ${ticket.ticket_number} | SmartWeight</title>
    <style>
      :root {
        --green: #0d5b2b;
        --ink: #17211b;
        --line: #d8ded9;
        --muted: #5b6560;
        --red: #b3261e;
      }
           * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
      }
      body {
        background: #fff;
        color: var(--ink);
        font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      .ticket {
        width: 100%;
        max-width: 190mm;
        min-height: 100%;
        margin: 0 auto;
        padding: 6mm 0;
        display: flex;
        flex-direction: column;
      }

      .header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12mm; padding-bottom: 4mm; border-bottom: 2px solid var(--green);
      }
      .brand { display: flex; align-items: center; gap: 8px; }
      .brand svg { width: 34px; height: auto; flex: none; }
      .brand-name { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; color: #1f1f1f; }
      .brand-name span { color: var(--green); }
      .brand-tag { margin-top: 2px; font-size: 8px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--muted); font-weight: 600; }

      .doc-title { text-align: right; }
      .doc-title h1 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: 0.3px; color: var(--green); text-transform: uppercase; }
      .doc-title .ticket-no { margin-top: 2px; font-size: 12px; font-weight: 700; color: #222924; }

      .status-badge {
        display: inline-block; margin-top: 3px; padding: 1.5px 6px;
        border-radius: 3px; font-size: 9px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.4px; color: #fff;
      }

      .meta-strip {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm;
        padding: 3mm 0; border-bottom: 1px dashed var(--line); font-size: 10px;
      }
      .meta-strip dt { color: var(--green); font-weight: 700; margin: 0 0 1px; text-transform: uppercase; letter-spacing: 0.4px; }
      .meta-strip dd { margin: 0; font-weight: 600; color: #222924; }

      .section { margin-top: 3mm; }
      .section-head {
        background: var(--green); color: #fff; padding: 2mm 3mm; font-size: 10px;
        font-weight: 700; letter-spacing: 1px; text-transform: uppercase; border-radius: 3px 3px 0 0;
      }
      .section-body { border: 1px solid var(--line); border-top: none; border-radius: 0 0 3px 3px; padding: 2mm 3mm; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 6mm; }
      .field { display: flex; justify-content: space-between; gap: 4mm; padding: 1.5mm 0; border-bottom: 1px solid #ecefed; font-size: 11px; }
      .field:last-child { border-bottom: none; }
      .field dt { color: var(--green); font-weight: 700; margin: 0; }
      .field dd { margin: 0; font-weight: 600; color: #222924; text-align: right; }

      .weights { border: 1px solid var(--line); border-radius: 3px; overflow: hidden; margin-top: 3mm; }
      .weight-row {
        display: grid; grid-template-columns: 1fr auto; align-items: center;
        padding: 2.5mm 4mm; border-bottom: 1px solid var(--line); font-size: 12px;
      }
      .weight-row:last-child { border-bottom: none; background: #f2f7f4; }
      .weight-row .label { font-weight: 700; color: var(--green); text-transform: uppercase; letter-spacing: 0.4px; }
      .weight-row .value { font-size: 16px; font-weight: 800; color: #141815; }

      .overload-warning {
        margin-top: 2mm; padding: 2mm 3mm; background: #fdecea; border: 1px solid var(--red);
        border-radius: 3px; font-size: 10px; font-weight: 700; color: var(--red); text-align: center;
      }

      .signatures {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 8mm; font-size: 10px;
      }
      .sign { text-align: center; }
      .sign .line { border-top: 1px solid #3b453e; margin: 0 auto 2mm; width: 70%; }
      .sign span { color: #3d4741; }

      .footer {
        margin-top: 5mm; padding-top: 2mm; border-top: 1px solid var(--line);
        display: flex; justify-content: space-between; font-size: 8.5px; color: var(--muted);
      }

     
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .ticket { max-width: 100%; padding: 0; }
      }
    </style>
  </head>
  <body>
    <main class="ticket">
      <header class="header">
        <div class="brand">
          <svg viewBox="0 0 120 78" aria-hidden="true">
            <g fill="#0d5b2b">
              <path d="M6 12h50c2 0 3 1 3 3v33H6c-2 0-3-1-3-3V15c0-2 1-3 3-3Zm6 8v6h35v-6H12Zm0 12v6h35v-6H12Z" />
              <path d="M63 20h23c1.6 0 3 .8 3.8 2.2L100 40v8h-37V20Zm7 7v9h20l-6-9H70Z" />
              <rect x="3" y="54" width="100" height="7" rx="2" />
              <circle cx="26" cy="50" r="7" /><circle cx="82" cy="50" r="7" />
            </g>
            <g fill="#fff"><circle cx="26" cy="50" r="3" /><circle cx="82" cy="50" r="3" /></g>
          </svg>
          <div>
            <div class="brand-name">SMART<span>WEIGHT</span></div>
            <div class="brand-tag">Intelligent Weighbridge Solution</div>
          </div>
        </div>
        <div class="doc-title">
          <h1>Weighbridge Ticket</h1>
          <div class="ticket-no">${ticket.ticket_number}</div>
          <div class="status-badge" style="background:${ticket.status === "completed" ? "#0d5b2b" : "#b3261e"}">
            ${ticket.status}
          </div>
        </div>
      </header>

      <dl class="meta-strip">
        <div><dt>Date</dt><dd>${dateStr}</dd></div>
        <div><dt>Time</dt><dd>${timeStr}</dd></div>
        <div><dt>Recorded By (User ID)</dt><dd>${ticket.user_id}</dd></div>
      </dl>

      <section class="section">
        <div class="section-head">Vehicle &amp; Cargo</div>
        <div class="section-body grid-2">
          <div class="field"><dt>Vehicle ID</dt><dd>${ticket.vehicle_id}</dd></div>
          <div class="field"><dt>Material</dt><dd>${ticket.material || "--"}</dd></div>
          <div class="field"><dt>Destination</dt><dd>${ticket.destination || "--"}</dd></div>
          <div class="field"><dt>Max Allowed</dt><dd>${ticket.max_allowed_weight}</dd></div>
        </div>
      </section>

      <div class="weights">
        <div class="weight-row">
          <span class="label">Measured (Gross) Weight</span>
          <span class="value">${ticket.measured_weight}</span>
        </div>
        <div class="weight-row">
          <span class="label">Tare Weight</span>
          <span class="value">${ticket.tare_weight}</span>
        </div>
        <div class="weight-row">
          <span class="label">Net Weight</span>
          <span class="value">${ticket.net_weight}</span>
        </div>
      </div>

      ${isOverloaded ? `<div class="overload-warning">⚠ OVERLOAD — measured weight exceeds max allowed by ${ticket.measured_weight - ticket.max_allowed_weight}</div>` : ""}

      <section class="signatures">
        <div class="sign"><div class="line"></div><span>Operator Signature</span></div>
        <div class="sign"><div class="line"></div><span>Customer Signature</span></div>
      </section>

      <footer class="footer">
        <span>www.smartweight.com</span>
        <span>+255 7XX XXX XXX</span>
        <span>SmartWeight Solutions</span>
      </footer>
    </main>
  </body>
</html>`;
}
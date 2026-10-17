import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
let  db = await Database.load("sqlite:smartweigh.db");

export async function getDatabase() {
  if (!db) {
    db = await Database.load("sqlite:smartweigh.db");
  }

  return db;
}

type User = {
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: string;
    created_at: string;
};

export type Setting = {
    email: string;
    password: string;
};


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

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
// export type Weighing = {
//   id: string;
//   ticketNumber: string;
//   vehicleId: string;      // plate_number
//   company: string;        // vehicles.transporter
//   tare: number;
//   gross: number;
//   net: number;
//   limit: number;          // weighing_records.max_allowed_weight
//   unit: string;
//   operator: string;       // users.name
//   driver: string;         // vehicles.driver_name
//   material: string | null;
//   destination: string | null;
//   date: string;
//   time: string;
//   status: "Pass" | "Overload";
// };

export type ShiftChange = {
  id: string;
  fromOperator: string;
  toOperator: string;
  reason: string;
  date: string;
  time: string;
};

export type OperatorActivity = {
  operator: string;
  action: string;
  entityType: string;
  detail: string;
  date: string;
  time: string;
};

export type ReportFilters = {
  dateFrom?: string;   // "YYYY-MM-DD"
  dateTo?: string;     // "YYYY-MM-DD"
  vehiclePlate?: string;
  company?: string;
  operatorId?: number;
};

/* ------------------------------------------------------------------ */
/* Row shapes returned by SQLite (raw column names)                    */
/* ------------------------------------------------------------------ */


export async function createUser(username:string,useremail:string,userpassword:string,userrole:string) {
   await db.execute(
  `INSERT INTO users
   (name, email, password_hash, role)
   VALUES (?, ?, ?, ?)`,
  [
    username,
    useremail,
    userpassword,
    userrole,
  ],
    );
}

export async function ReadUsers() {
 const users = await db.select<User[]>("SELECT * FROM users");
 return users;
}

export async function ReadUserById(id: number): Promise<string | null> {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM users WHERE id = ?",
    [id]
  );
  return rows[0]?.name ?? null;
}

export async function ChangeUserRole(userId: number, newRole: string) {
  await db.execute(
    `UPDATE users SET role = ? WHERE id = ?`,
    [newRole, userId]
  );
}

export async function Login(useremail:string){
    const user= await db.select<User[]>("SELECT * FROM users WHERE email = ?", [useremail]);
    if(user[0]){
        return user[0];
    }else{
        console.log("No user Found");
    } 
}

export async function sendEmail(
    recipient: string,
    gmail: string,
    appPassword: string
) {
    return await invoke<string>("send_email", {
        recipient,
        gmail,
        appPassword,
    });
}

export async function SaveSetting(email:string,password:string) {
    await db.execute(`INSERT INTO settings (email,password) values(?,?)`,[email,password]);
}

export async function getSetting(){
    const settings=await db.select<Setting[]>("SELECT * FROM settings");
    return settings[0];
}

export async function createTicketRecord(record: TicketRecord): Promise<void> {
 

  await db.execute(
    `INSERT INTO weighing_records (
      vehicle_id,
      user_id,
      tare_weight,
      gross_weight,
      net_weight,
      max_allowed_weight,
      unit,
      weighing_status,
      ticket_number,
      created_at,
      material,
      destination
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.vehicle_id,
      record.user_id,
      record.tare_weight,
      record.measured_weight,
      record.net_weight,
      record.max_allowed_weight,
      record.unit,
      record.status,
      record.ticket_number,
      record.created_at,
      record.material || null,
      record.destination || null,
    ]
  );
}


export async function ReadTicket(){
  const Tickets = await db.select<TicketRecord[]>("SELECT * FROM weighing_records");
  return Tickets;
}

export async function ReadTicketByNumber(ticketNumber:string){
const Ticket = await db.select<TicketRecord[]>("SELECT * FROM weighing_records WHERE ticket_number = ?",[ticketNumber] );
return Ticket;
}

export async function saveTicketScreenshot(ticketNumber: string, camera: "front" | "rear", imageData: string) {
  await db.execute(
    `INSERT INTO ticket_photos (
      ticket_number,
      camera,
      screenshot_data,
      created_at
    ) VALUES (?, ?, ?, ?)`,
    [ticketNumber, camera, imageData, new Date().toISOString()]
  );
}






function splitDateTime(createdAt: string): { date: string; time: string } {
  // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS"
  const [date, time] = createdAt.split(" ");
  return { date, time: time ? time.slice(0, 5) : "" };
}



export type WeighingRow = {
  id: number;
  ticket_number: string;
  plate_number: string;
  transporter: string | null;
  tare_weight: number | null;
  gross_weight: number | null;
  net_weight: number | null;
  max_allowed_weight: number | null;
  unit: string | null;
  operator_name: string | null;
  driver_name: string | null;
  material: string | null;
  destination: string | null;
  weighing_status: string | null;
  created_at: string;
};

export type Weighing = {
  id: string;
  ticketNumber: string;
  vehicleId: string;
  company: string;
  material: string;
  destination: string;
  tare: number;
  gross: number;
  net: number;
  limit: number;
  operator: string;
  driver: string;
  date: string;
  time: string;
  status: "Pass" | "Overload";
};

function mapWeighingRow(r: WeighingRow): Weighing {
  const d = new Date(r.created_at);
  const ok = !isNaN(d.getTime());
  const pad = (n: number) => String(n).padStart(2, "0");

  const gross = Number(r.gross_weight) || 0;
  const limit = Number(r.max_allowed_weight) || 0;
  const overloaded = r.weighing_status
    ? r.weighing_status === "overweight"
    : limit > 0 && gross > limit;

  return {
    id: String(r.id),
    ticketNumber: r.ticket_number,
    vehicleId: r.plate_number,
    company: r.transporter ?? "",
    material: r.material ?? "",
    destination: r.destination ?? "",
    tare: Number(r.tare_weight) || 0,
    gross,
    net: Number(r.net_weight) || 0,
    limit,
    operator: r.operator_name ?? "",
    driver: r.driver_name ?? "",
    // local date/time, so a ticket weighed after midnight in Tanzania
    // is not filed under the previous (UTC) day
    date: ok ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "",
    time: ok ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "",
    status: overloaded ? "Overload" : "Pass",
  };
}

/* ------------------------------------------------------------------ */
/* Core weighing report — single JOIN query, filterable                */
/* ------------------------------------------------------------------ */
export async function fetchWeighings(filters: ReportFilters = {}): Promise<Weighing[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.dateFrom) {
    conditions.push("date(w.created_at) >= date(?)");
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push("date(w.created_at) <= date(?)");
    params.push(filters.dateTo);
  }
  if (filters.vehiclePlate) {
    conditions.push("v.plate_number = ?");
    params.push(filters.vehiclePlate);
  }
  if (filters.company) {
    conditions.push("v.transporter = ?");
    params.push(filters.company);
  }
  if (filters.operatorId) {
    conditions.push("w.user_id = ?");
    params.push(filters.operatorId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db.select<WeighingRow[]>(
    `
    SELECT
      w.id                  AS id,
      w.ticket_number        AS ticket_number,
      v.plate_number          AS plate_number,
      v.transporter            AS transporter,
      w.tare_weight            AS tare_weight,
      w.gross_weight           AS gross_weight,
      w.net_weight             AS net_weight,
      w.max_allowed_weight     AS max_allowed_weight,
      w.unit                   AS unit,
      u.name                   AS operator_name,
      v.driver_name             AS driver_name,
      w.material                AS material,
      w.destination              AS destination,
      w.created_at                AS created_at
    FROM weighing_records w
    JOIN vehicles v ON v.id = w.vehicle_id
    LEFT JOIN users u ON u.id = w.user_id
    ${whereClause}
    ORDER BY w.created_at DESC
    `,
    params
  );

  return rows.map(mapWeighingRow);
}

/* ------------------------------------------------------------------ */
/* Overloaded vehicles — reuses the same filters, just adds a HAVING   */
/* ------------------------------------------------------------------ */
export async function fetchOverloadedWeighings(filters: ReportFilters = {}): Promise<Weighing[]> {
  const all = await fetchWeighings(filters);
  return all.filter((w) => w.status === "Overload");
}

/* ------------------------------------------------------------------ */
/* Distinct filter option lists — for populating the dropdowns         */
/* ------------------------------------------------------------------ */
export async function fetchVehicleOptions(): Promise<string[]> {
  const rows = await db.select<{ plate_number: string }[]>(
    "SELECT DISTINCT plate_number FROM vehicles ORDER BY plate_number"
  );
  return rows.map((r) => r.plate_number);
}

export async function fetchCompanyOptions(): Promise<string[]> {
  const rows = await db.select<{ transporter: string }[]>(
    "SELECT DISTINCT transporter FROM vehicles ORDER BY transporter"
  );
  return rows.map((r) => r.transporter);
}

export async function fetchOperatorOptions(): Promise<{ id: number; name: string }[]> {
  const rows = await db.select<{ id: number; name: string }[]>(
    "SELECT id, name FROM users  ORDER BY name"
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Operator activity — sourced from audit_logs                         */
/* ------------------------------------------------------------------ */
type ActivityRow = {
  operator_name: string;
  action: string;
  entity_type: string;
  details: string | null;
  created_at: string;
};

export async function fetchOperatorActivity(limit = 100): Promise<OperatorActivity[]> {
  const rows = await db.select<ActivityRow[]>(
    `
    SELECT
      u.name        AS operator_name,
      a.action        AS action,
      a.entity_type    AS entity_type,
      a.details         AS details,
      a.created_at        AS created_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT ?
    `,
    [limit]
  );

  return rows.map((r) => {
    const { date, time } = splitDateTime(r.created_at);
    return {
      operator: r.operator_name ?? "Unknown",
      action: r.action,
      entityType: r.entity_type,
      detail: r.details ?? "—",
      date,
      time,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Shift changes — REQUIRES a convention on audit_logs (see note)      */
/* action = 'SHIFT_CHANGE', details = JSON string:                     */
/*   { "to_user_id": number, "to_user_name": string, "reason": string }*/
/* ------------------------------------------------------------------ */
type ShiftChangeRow = {
  from_operator: string;
  details: string | null;
  created_at: string;
};

export async function fetchShiftChanges(limit = 100): Promise<ShiftChange[]> {
  const rows = await db.select<ShiftChangeRow[]>(
    `
    SELECT
      u.name        AS from_operator,
      a.details       AS details,
      a.created_at      AS created_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action = 'SHIFT_CHANGE'
    ORDER BY a.created_at DESC
    LIMIT ?
    `,
    [limit]
  );

  return rows.map((r, idx) => {
    const { date, time } = splitDateTime(r.created_at);
    let toOperator = "Unknown";
    let reason = "—";
    try {
      const parsed = r.details ? JSON.parse(r.details) : {};
      toOperator = parsed.to_user_name ?? toOperator;
      reason = parsed.reason ?? reason;
    } catch {
      // malformed details JSON — leave defaults
    }
    return {
      id: String(idx),
      fromOperator: r.from_operator ?? "Unknown",
      toOperator,
      reason,
      date,
      time,
    };
  });
}




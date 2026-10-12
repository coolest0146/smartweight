import Database from "@tauri-apps/plugin-sql";

export type MasterEntry = { id: number; value: string };

// Table names are hardcoded literals below and never come from user input,
// so string-interpolating them into SQL here is safe.
const TABLES = {
  partyNames: "party_names",
  commodities: "commodities",
  plateNumbers: "plate_numbers",
  truckTypes: "truck_types",
} as const;

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    // Reuses the same sqlite file the rest of the app already persists to.
    dbPromise = Database.load("sqlite:smartweigh.db");
  }
  return dbPromise;
}

async function ensureTables() {
  const db = await getDb();
  for (const table of Object.values(TABLES)) {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${table} (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         value TEXT NOT NULL UNIQUE
       )`
    );
  }
}

export async function listEntries(table: string): Promise<MasterEntry[]> {
  const db = await getDb();
  return db.select<MasterEntry[]>(`SELECT id, value FROM ${table} ORDER BY value ASC`);
}

async function addEntry(table: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Value cannot be empty.");
  const db = await getDb();
  await db.execute(`INSERT INTO ${table} (value) VALUES ($1)`, [trimmed]);
}

async function deleteEntry(table: string, id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

// Call once, e.g. in App.tsx on startup, so the tables exist before Settings mounts.
export async function initMasterDataTables() {
  await ensureTables();
}

export const partyNames = {
  list: () => listEntries(TABLES.partyNames),
  add: (value: string) => addEntry(TABLES.partyNames, value),
  remove: (id: number) => deleteEntry(TABLES.partyNames, id),
};

export const commodities = {
  list: () => listEntries(TABLES.commodities),
  add: (value: string) => addEntry(TABLES.commodities, value),
  remove: (id: number) => deleteEntry(TABLES.commodities, id),
};

export const plateNumbers = {
  list: () => listEntries(TABLES.plateNumbers),
  add: (value: string) => addEntry(TABLES.plateNumbers, value),
  remove: (id: number) => deleteEntry(TABLES.plateNumbers, id),
};

export const truckTypes = {
  list: () => listEntries(TABLES.truckTypes),
  add: (value: string) => addEntry(TABLES.truckTypes, value),
  remove: (id: number) => deleteEntry(TABLES.truckTypes, id),
};


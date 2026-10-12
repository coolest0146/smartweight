import Database from "@tauri-apps/plugin-sql";
let  db = await Database.load("sqlite:smartweigh.db");
export type AuditAction = "SHIFT_HANDOVER" | "SHIFT_HANDOVER_FAILED";

export interface AuditLogEntry {
  /** The user the action is attributed to (see note in OperatorPage on who this is for handovers). */
  userId: number;
  action: AuditAction;
  entityType: string;
  entityId?: number | null;
  details?: string;
}

export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {

  await db.execute(
    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)",
    [entry.userId, entry.action, entry.entityType, entry.entityId ?? null, entry.details ?? null]
  );
}

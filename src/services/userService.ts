import bcrypt from "bcryptjs";
import Database from "@tauri-apps/plugin-sql";
let  db = await Database.load("sqlite:smartweigh.db");

// Every user is an operator — there's no separate operator table/role.
export interface Operator {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface UserRow extends Operator {
  password_hash: string;
}

export async function loadOperators(): Promise<Operator[]> {
  return db.select<Operator[]>("SELECT id, name, email, role FROM users ORDER BY name ASC");
}

/**
 * Verifies `password` against the stored bcrypt hash for the given user.
 * Returns false (not a thrown error) for "user not found" or "wrong password" —
 * both should look identical to the caller so the UI can't be used to enumerate
 * valid user IDs.
 */
export async function verifyOperatorPassword(userId: number, password: string): Promise<boolean> {
  
  const rows = await db.select<UserRow[]>(
    "SELECT id, name, email, role, password_hash FROM users WHERE id = $1",
    [userId]
  );
  const user = rows[0];
  if (!user) return false;
  return bcrypt.compare(password, user.password_hash);
}

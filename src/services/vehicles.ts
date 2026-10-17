import { getDatabase } from "./database";

export type VehicleRecords={
    id:number;
    plate_number:string;
    transporter:string;
    truck_type:string;
    max_permissible_weight:number;
    tare_weight:number;
    driver_name:string;
    driver_license:string;
    material:string | null;
    destination:string | null;
    created_at:string;
}

const db = await getDatabase();

export async function CreateVehicle(
  platenumber:string,
  transporter:string,
  trucktype:string,
  maxpermissibleweight:number,
  tareweight:number,
  drivername:string,
  driverlicense:string,
  material:string = "",
  destination:string = ""
) {
    const result = await db.execute(
      `
      INSERT INTO vehicles (
        plate_number,
        transporter,
        truck_type,
        max_permissible_weight,
        tare_weight,
        driver_name,
        driver_license,
        material,
        destination
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        platenumber,
        transporter,
        trucktype,
        maxpermissibleweight,
        tareweight ? Number(tareweight) : null,
        drivername.trim() || null,
        driverlicense.trim().toUpperCase() || null,
        material.trim() || null,
        destination.trim() || null,
      ]
    );

    return Number((result as { lastInsertId?: number | string }).lastInsertId ?? 0);
}

export async function ReadVehicles() {
    const vehicles = await db.select<VehicleRecords[]>("SELECT * FROM vehicles");
    return vehicles;
}

export async function UpdatedVehicleTareWeight(id: number, tareWeight: number) {
  await db.execute(
    `UPDATE vehicles SET tare_weight = ? WHERE id = ?`,
    [tareWeight, id]
  );
}

export async function ReadVehicleById(id: number): Promise<VehicleRecords | null> {
  const rows = await db.select<VehicleRecords[]>(
    "SELECT * FROM vehicles WHERE id = ?",
    [id]
  );
  return rows[0] ?? null;
}
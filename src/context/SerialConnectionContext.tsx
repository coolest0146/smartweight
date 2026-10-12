// src/context/SerialConnectionContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "failed"|"stale";

export interface WeightReading {
  weight: number;
  unit: string;
  stable: boolean;
  mode: string;
}

interface SerialConnectionContextValue {
  status: ConnectionStatus;
  error: string | null;
  reading: WeightReading | null;
  startReading: (port: string, baudRate: number) => Promise<void>;
}

// Shape actually returned by the Rust `get_connection_status` command
interface ConnectionStatusResponse {
  status: string; // raw string from Rust, e.g. "Connected" or "connected"
  error: string | null;
}

function normalizeStatus(raw: string): ConnectionStatus {
  const lowered = raw.toLowerCase();
  if (
    lowered === "disconnected" ||
    lowered === "connecting" ||
    lowered === "connected" ||
    lowered === "failed" ||
    lowered === "stale"
  ) {
    return lowered;
  }
  console.warn(`Unrecognized connection status from backend: "${raw}"`);
  return "disconnected";
}

const SerialConnectionContext = createContext<SerialConnectionContextValue | null>(null);

export function SerialConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<WeightReading | null>(null);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    (async () => {
      try {
        const result = await invoke<ConnectionStatusResponse>("get_connection_status");
        setStatus(normalizeStatus(result.status));
        setError(result.error);
      } catch (e) {
        console.error("Failed to fetch current connection status:", e);
      }

      unlisteners.push(
        await listen<string>("serial-connected", () => {
          setStatus("connected");
          setError(null);
        })
      );

       unlisteners.push(
        await listen<string>("serial-stale", () => {
          setStatus("stale");
          setError(null);
        })
      );
      
       unlisteners.push(
        await listen<string>("serial-recovered", () => {
          setStatus("connected");
          setError(null);
        })
      );
      unlisteners.push(
        await listen<string>("serial-error", (event) => {
          setStatus("failed");
          setError(event.payload);
        })
      );

      unlisteners.push(
        await listen<string>("serial-disconnected", (event) => {
          setStatus("disconnected");
          setError(event.payload);
        })
      );

      unlisteners.push(
        await listen<WeightReading>("weight-data", (event) => {
          setReading(event.payload);
        })
      );
    })();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const startReading = async (port: string, baudRate: number) => {
    setStatus("connecting");
    try {
      await invoke("start_serial_reading", { portName: port, baudRate });
    } catch (e) {
      setStatus("failed");
      setError(String(e));
    }
  };

  return (
    <SerialConnectionContext.Provider value={{ status, error, reading, startReading }}>
      {children}
    </SerialConnectionContext.Provider>
  );
}

export function useSerialConnection() {
  const ctx = useContext(SerialConnectionContext);
  if (!ctx) {
    throw new Error("useSerialConnection must be used within a SerialConnectionProvider");
  }
  return ctx;
}
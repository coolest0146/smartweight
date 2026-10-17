// src/context/SerialConnectionContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "failed" | "stale";

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
  startReading: (port1: string, port2: string, port3: string, baudRate: number, jumboPort: string) => Promise<void>;
}

interface ScaleStatus {
  status: string;
  error: string | null;
  current_weight: number;
}

interface ConnectionStatusResponse {
  scale1: ScaleStatus;
  scale2: ScaleStatus;
  scale3: ScaleStatus;
  system_active: boolean;
}

const SerialConnectionContext = createContext<SerialConnectionContextValue | null>(null);

export function SerialConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<WeightReading | null>(null);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    // Helper function to calculate aggregate system health from individual scale parameters
    const refreshSystemStatus = async () => {
      try {
        const response = await invoke<ConnectionStatusResponse>("get_connection_status");
        
        const scales = [response.scale1, response.scale2, response.scale3];
        const activeScales = scales.filter(s => s.status.toLowerCase() !== "disconnected");

        if (activeScales.length === 0) {
          setStatus("disconnected");
          setError(null);
          return;
        }

        // Aggregate Evaluation: Only go completely stale if ALL active ports drop out
        if (activeScales.every(s => s.status.toLowerCase() === "stale")) {
          setStatus("stale");
          setError("All connected indicators have gone stale.");
        } else if (activeScales.some(s => s.status.toLowerCase() === "failed")) {
          setStatus("failed");
          setError("One or more weighing scales encountered a terminal error.");
        } else {
          setStatus("connected");
          setError(null);
        }
      } catch (e) {
        console.error("Failed to parse system health matrices:", e);
      }
    };

    // Initialize state on mount
    (async () => {
      await refreshSystemStatus();

      unlisteners.push(
        await listen<string>("serial-connected", () => {
          refreshSystemStatus();
        })
      );

      unlisteners.push(
        await listen<string>("scale-stale", (event) => {
          console.warn(`Weighbridge indicator [${event.payload}] went offline/stale.`);
          refreshSystemStatus();
        })
      );
      
      unlisteners.push(
        await listen<string>("scale-recovered", (event) => {
          console.log(`Weighbridge indicator [${event.payload}] restored connection.`);
          refreshSystemStatus();
        })
      );

      unlisteners.push(
        await listen<string>("serial-error", (event) => {
          setStatus("failed");
          setError(event.payload);
        })
      );

      unlisteners.push(
        await listen<string>("serial-disconnected", () => {
          refreshSystemStatus();
        })
      );

      // Catching the single total combined sum calculated and pushed by Rust
      unlisteners.push(
        await listen<WeightReading>("summed-weight-data", (event) => {
          setReading(event.payload);
        })
      );
    })();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const startReading = async (port1: string, port2: string, port3: string, baudRate: number, jumboPort: string) => {
    setStatus("connecting");
    setError(null);
    try {
      await invoke("start_serial_reading", {     
        portScale1: port1,
        portScale2: port2,
        portScale3: port3,
        baudRate: baudRate, 
        jumboPort: jumboPort
      });
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

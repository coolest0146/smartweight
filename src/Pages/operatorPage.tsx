import { FormEvent, useEffect, useState } from "react";
import { loadOperators, Operator, verifyOperatorPassword } from "../services/userService";
import { recordAuditLog } from "../services/auditLogService";

type SessionUser = { id: number; fullName: string; role: string };

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export default function OperatorPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [activeOperatorId, setActiveOperatorId] = useState<number | null>(() => {
    const stored = localStorage.getItem("activeOperatorId");
    return stored ? Number(stored) : null;
  });
  const [targetOperator, setTargetOperator] = useState<Operator | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const sessionUser = JSON.parse(localStorage.getItem("currentUser") || "null") as SessionUser | null;

  const refreshOperators = async () => {
    try {
      const nextOperators = await loadOperators();
      setOperators(nextOperators);
    } catch {
      setError("Unable to load the operator list.");
    }
  };

  useEffect(() => { void refreshOperators(); }, []);
  useEffect(() => {
    const handleUsersChanged = () => { void refreshOperators(); };
    window.addEventListener("users-changed", handleUsersChanged);
    return () => window.removeEventListener("users-changed", handleUsersChanged);
  }, []);
  useEffect(() => {
    if (activeOperatorId != null) localStorage.setItem("activeOperatorId", String(activeOperatorId));
    else localStorage.removeItem("activeOperatorId");
  }, [activeOperatorId]);

  const activeOperator = operators.find((operator) => operator.id === activeOperatorId);

  const beginHandover = (operator: Operator) => {
    setTargetOperator(operator);
    setPassword("");
    setError("");
  };

  const confirmHandover = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!targetOperator) return;

    setIsConfirming(true);
    setError("");

    try {
      const isValid = await verifyOperatorPassword(targetOperator.id, password);

      if (!isValid) {
        setError(`Incorrect password for ${targetOperator.name}.`);
        // Attributed to whoever is at the keyboard (sessionUser), since the
        // target's identity was never actually proven in a failed attempt.
        if (sessionUser) {
          await recordAuditLog({
            userId: sessionUser.id,
            action: "SHIFT_HANDOVER_FAILED",
            entityType: "shift_handover",
            entityId: targetOperator.id,
            details: `${sessionUser.fullName} attempted to hand the shift to ${targetOperator.name}, but the password was incorrect.`,
          }).catch(() => { /* don't let logging failures mask the real error */ });
        }
        return;
      }

      // Attributed to the target operator: entering a correct password IS the
      // proof that they're the one accepting the shift.
      await recordAuditLog({
        userId: targetOperator.id,
        action: "SHIFT_HANDOVER",
        entityType: "shift_handover",
        entityId: activeOperatorId,
        details: `Shift handed over from ${activeOperator?.name ?? "no operator"} to ${targetOperator.name}.`,
      });

      setActiveOperatorId(targetOperator.id);
      setTargetOperator(null);
      setPassword("");
    } catch (handoverError) {
      setError(getErrorMessage(handoverError, "Unable to complete the handover. Please try again."));
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="min-h-screen bg-blue-100 text-white font-mono">
    
      <main className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-3">
        <section className="rounded border border-slate-800 bg-blue-100 p-6 lg:col-span-1">
          <p className="text-xs uppercase tracking-widest text-slate-900">Signed in operator</p>
          <h1 className="mt-2 text-2xl font-bold text-green-400">{sessionUser?.fullName || "Operator"}</h1>
          <p className="mt-1 text-sm text-slate-900">{sessionUser?.role || "OPERATOR"}</p>
          <div className="mt-6 border-t border-slate-800 pt-5">
            <p className="text-xs uppercase tracking-widest text-slate-900">Current shift controller</p>
            <p className="mt-2 text-lg font-bold text-orange-900">{activeOperator?.name || "No operator selected"}</p>
            {activeOperator && <p className="text-xs tracking-widest text-slate-900">{activeOperator.email} · {activeOperator.role}</p>}
          </div>
        </section>

        <section className="rounded border border-slate-800 bg-blue-100 p-6 lg:col-span-2">
          <h2 className="text-xl font-bold uppercase text-green-500">Shift handover</h2>
          <p className="mt-1 text-sm text-slate-900">Select who's taking over terminal control. They must enter their own password to accept the shift, and every attempt — successful or not — is written to the audit log.</p>
          {error && !targetOperator && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
          <div className="mt-5 space-y-3">
            {operators.filter((operator) => operator.id !== sessionUser?.id).map((operator) => {
              const isCurrent = operator.id === activeOperatorId;
              return <div key={operator.id} className={`flex items-center justify-between gap-4 rounded border p-4 ${isCurrent ? "border-green-700 bg-green-500/5" : "border-slate-800 bg-slate-950/60"}`}>
                <div>
                  <p className={isCurrent ? "font-bold text-green-400" : "font-bold text-slate-200"}>{operator.name}</p>
                  <p className="text-xs text-slate-500">{operator.email} · {operator.role}</p>
                </div>
                {isCurrent ? <span className="text-xs font-bold uppercase text-green-400">On shift</span> : <button type="button" onClick={() => beginHandover(operator)} className="rounded bg-orange-500 px-3 py-2 text-xs font-bold uppercase text-black hover:bg-orange-400">Handover</button>}
              </div>;
            })}
          </div>
        </section>
      </main>

      {targetOperator && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-6">
          <h3 className="font-bold text-orange-400">Confirm handover</h3>
          <p className="mt-2 text-sm text-slate-400">{targetOperator.name} must enter their password to accept this shift.</p>
          {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          <form onSubmit={confirmHandover} className="mt-5 space-y-4">
            <input
              type="password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`${targetOperator.name}'s password`}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-green-500"
            />
            <div className="flex gap-3">
              <button type="submit" disabled={isConfirming} className="flex-1 rounded bg-orange-500 py-2 text-xs font-bold uppercase text-black disabled:opacity-50">
                {isConfirming ? "Verifying…" : "Confirm"}
              </button>
              <button type="button" onClick={() => { setTargetOperator(null); setPassword(""); setError(""); }} className="rounded border border-slate-700 px-4 text-xs uppercase">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>}
    </div>
  );
}

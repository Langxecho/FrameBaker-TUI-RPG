import { Buffer } from "node:buffer";

export type Limits = { maxCalls: number; maxWallMs: number; maxResponseBytes: number };
export type Receipt = {
  sequence: number;
  operation: string;
  outcome: "pending" | "ok" | "error" | "interrupted";
  startedAt: string;
  elapsedMs: number | null;
  responseBytes: number | null;
  observedElapsedMs: number | null;
  observedResponseBytes: number | null;
  chargedWallMs: number;
  chargedResponseBytes: number;
  limitSnapshot: Limits;
  tokens: null;
  needsReconcile?: boolean;
  status?: number;
  error?: string;
};
export type BudgetState = { limits: Limits; legacyCalls: number; receipts: Receipt[] };

export const DEFAULT_LIMITS: Limits = { maxCalls: 16, maxWallMs: 300_000, maxResponseBytes: 4_194_304 };

export function parseLimit(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label} must be a positive safe integer`);
  return Number(value);
}

export function createBudget(
  state: { calls?: number; budget?: BudgetState },
  requested: Partial<Limits>,
  save: () => void,
) {
  if (!state.budget) {
    state.budget = { limits: { ...DEFAULT_LIMITS, ...requested }, legacyCalls: state.calls ?? 0, receipts: [] };
    save();
  } else if (Object.keys(requested).length) {
    state.budget.limits = { ...state.budget.limits, ...requested };
    save();
  }
  const budget = state.budget;
  // Migrate receipts written before observed/charged fields existed. Completed
  // entries have exact historical observations; an old pending entry is kept
  // conservative and explicitly requires reconciliation.
  for (const receipt of budget.receipts) {
    if (!receipt.limitSnapshot) receipt.limitSnapshot = { ...budget.limits };
    if (receipt.observedElapsedMs === undefined) receipt.observedElapsedMs = receipt.elapsedMs;
    if (receipt.observedResponseBytes === undefined) receipt.observedResponseBytes = receipt.responseBytes;
    if (receipt.chargedWallMs === undefined) receipt.chargedWallMs = receipt.elapsedMs ?? budget.limits.maxWallMs;
    if (receipt.chargedResponseBytes === undefined) receipt.chargedResponseBytes = receipt.responseBytes ?? budget.limits.maxResponseBytes;
    if (receipt.outcome === "pending" && !receipt.needsReconcile) receipt.needsReconcile = true;
  }
  save();
  // Preserve the original reservation on interrupted attempts. It is a conservative
  // charge, not an observation, and must not be recomputed after limits change.
  for (const receipt of budget.receipts) {
    if (receipt.outcome !== "pending") continue;
    receipt.outcome = "interrupted";
    receipt.error = "interrupted before a final receipt";
    receipt.elapsedMs = null;
    receipt.responseBytes = null;
    receipt.needsReconcile = true;
    save();
  }
  const chargedTotals = () => ({
    wallMs: budget.receipts.reduce((sum, item) => sum + item.chargedWallMs, 0),
    responseBytes: budget.receipts.reduce((sum, item) => sum + item.chargedResponseBytes, 0),
  });
  const totals = () => ({
    calls: budget.legacyCalls + budget.receipts.length,
    observedWallMs: budget.receipts.reduce((sum, item) => sum + (item.observedElapsedMs ?? 0), 0),
    observedResponseBytes: budget.receipts.reduce((sum, item) => sum + (item.observedResponseBytes ?? 0), 0),
    conservativeChargedWallMs: chargedTotals().wallMs,
    conservativeChargedResponseBytes: chargedTotals().responseBytes,
    tokens: null as null,
    legacyUnmeteredCalls: budget.legacyCalls,
  });
  async function run<T>(operation: string, request: (signal: AbortSignal) => Promise<Response>, decode: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
    const used = totals();
    const remainingMs = budget.limits.maxWallMs - used.conservativeChargedWallMs;
    const remainingBytes = budget.limits.maxResponseBytes - used.conservativeChargedResponseBytes;
    if (used.calls >= budget.limits.maxCalls || remainingMs <= 0 || remainingBytes <= 0) {
      const pending = budget.receipts.some((item) => item.needsReconcile);
      throw new Error(`Recipe budget exhausted before ${operation}${pending ? "; pending receipt needs reconcile" : ""}; checkpoint preserved`);
    }
    const receipt: Receipt = { sequence: budget.receipts.length + 1, operation, outcome: "pending", startedAt: new Date().toISOString(), elapsedMs: null, responseBytes: null, observedElapsedMs: null, observedResponseBytes: null, chargedWallMs: remainingMs, chargedResponseBytes: remainingBytes, limitSnapshot: { ...budget.limits }, tokens: null };
    budget.receipts.push(receipt);
    state.calls = used.calls + 1;
    save();
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(120_000, remainingMs));
    let observedBytes = 0;
    try {
      const response = await request(controller.signal);
      receipt.status = response.status;
      if (!response.body) throw new Error("empty HTTP response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          observedBytes = length;
          if (length > remainingBytes) {
            controller.abort();
            await reader.cancel("response byte budget exceeded").catch(() => undefined);
            throw new Error("response byte budget exceeded");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await decode(Buffer.concat(chunks, length));
      receipt.outcome = "ok";
      receipt.elapsedMs = Math.ceil(performance.now() - started);
      receipt.responseBytes = length;
      receipt.observedElapsedMs = receipt.elapsedMs;
      receipt.observedResponseBytes = length;
      receipt.chargedWallMs = receipt.elapsedMs;
      receipt.chargedResponseBytes = length;
      return result;
    } catch (error) {
      receipt.outcome = "error";
      // Only local classification or HTTP status reaches the checkpoint; response bodies can contain secrets.
      receipt.error = error instanceof Error && /^(HTTP \d{3}|response byte budget exceeded|empty HTTP response)$/.test(error.message)
        ? error.message : "request or response validation failed";
      throw new Error(`${operation}: ${receipt.error}`);
    } finally {
      clearTimeout(timeout);
      if (receipt.outcome !== "ok") {
        receipt.elapsedMs = Math.ceil(performance.now() - started);
        receipt.responseBytes = observedBytes;
        receipt.observedElapsedMs = receipt.elapsedMs;
        receipt.observedResponseBytes = observedBytes;
        receipt.chargedWallMs = receipt.elapsedMs;
        receipt.chargedResponseBytes = observedBytes;
      }
      save();
      console.log(JSON.stringify({ operation, outcome: receipt.outcome, elapsedMs: receipt.elapsedMs, responseBytes: receipt.responseBytes, chargedWallMs: receipt.chargedWallMs, chargedResponseBytes: receipt.chargedResponseBytes, tokens: null }));
    }
  }
  return { run, totals, limits: budget.limits };
}

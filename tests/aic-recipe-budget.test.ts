import { describe, expect, test } from "bun:test";
import { createBudget, DEFAULT_LIMITS, type BudgetState } from "../scripts/aic_recipe_budget";

const response = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain" } });

describe("AIC recipe budget receipts", () => {
  test("counts failed calls and refuses the next operation at the call limit", async () => {
    const state: { calls?: number; budget?: BudgetState } = {};
    let saves = 0;
    const budget = createBudget(state, { maxCalls: 1 }, () => saves++);
    await expect(budget.run("failed", async () => response(503, "secret server detail"), async () => null)).rejects.toThrow("HTTP 503");
    expect(state.budget?.receipts[0]).toMatchObject({ outcome: "error", status: 503, responseBytes: 20, chargedResponseBytes: 20, tokens: null, error: "HTTP 503" });
    await expect(budget.run("blocked", async () => response(200, "ok"), async () => null)).rejects.toThrow("budget exhausted before blocked");
    expect(saves).toBeGreaterThan(1);
  });

  test("enforces response bytes before decoding and preserves unknown token count", async () => {
    const state: { budget?: BudgetState } = {};
    const budget = createBudget(state, { ...DEFAULT_LIMITS, maxResponseBytes: 3 }, () => {});
    await expect(budget.run("too-large", async () => response(200, "1234"), async () => "decoded")).rejects.toThrow("response byte budget exceeded");
    expect(state.budget?.receipts[0]).toMatchObject({ outcome: "error", responseBytes: 4, chargedResponseBytes: 4, tokens: null, error: "response byte budget exceeded" });
    expect(budget.totals().tokens).toBeNull();
  });

  test("cancels a multi-chunk response when the byte budget is exceeded", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        if (pulls > 1) controller.enqueue(new Uint8Array([5, 6, 7, 8]));
      },
      cancel() { cancelled = true; },
    });
    const state: { budget?: BudgetState } = {};
    const budget = createBudget(state, { ...DEFAULT_LIMITS, maxResponseBytes: 5 }, () => {});
    await expect(budget.run("stream-too-large", async () => new Response(body), async () => null)).rejects.toThrow("response byte budget exceeded");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(2);
  });

  test("turns an unfinished receipt into an interrupted historical charge on resume", () => {
    const state: { budget?: BudgetState } = { budget: { limits: DEFAULT_LIMITS, legacyCalls: 0, receipts: [{ sequence: 1, operation: "crashed", outcome: "pending", startedAt: new Date().toISOString(), elapsedMs: null, responseBytes: null, observedElapsedMs: null, observedResponseBytes: null, chargedWallMs: 123, chargedResponseBytes: 456, limitSnapshot: DEFAULT_LIMITS, tokens: null }] } };
    createBudget(state, { maxWallMs: 999_999, maxResponseBytes: 999_999 }, () => {});
    expect(state.budget?.receipts[0]).toMatchObject({ outcome: "interrupted", elapsedMs: null, responseBytes: null, chargedWallMs: 123, chargedResponseBytes: 456, needsReconcile: true, tokens: null, error: "interrupted before a final receipt" });
    expect(state.budget?.receipts[0]?.limitSnapshot).toEqual(DEFAULT_LIMITS);
  });
});

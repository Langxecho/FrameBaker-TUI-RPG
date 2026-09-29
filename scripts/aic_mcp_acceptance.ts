/**
 * Read-only AIC numeric acceptance through the public MCP HTTP surface.
 * Does not import server/db modules and never modifies the project.
 *
 * bun scripts/aic_mcp_acceptance.ts \
 *   --project 3c9712bc-6a69-473f-be16-ccd042ef853f \
 *   --url http://127.0.0.1:3025 \
 *   --revision 2
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Metric = {
  sequence: number;
  tool: string;
  arguments: Record<string, unknown>;
  elapsedMs: number;
  responseBytes: number;
  httpStatus: number;
  isError: boolean;
};

type ToolReceipt = Metric & { value: any; envelope: any };

const values = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!;
  if (![
    "--project", "--url", "--revision", "--out-root", "--socket-id",
  ].includes(key) || values.has(key) || !process.argv[i + 1]) throw new Error(`Invalid argument: ${key}`);
  values.set(key, process.argv[++i]!);
}

const projectId = values.get("--project");
if (!projectId) throw new Error("--project <skeletal project ID> is required");
const expectedRevision = Number(values.get("--revision") ?? "2");
if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("--revision must be a non-negative integer");
const base = new URL(values.get("--url") ?? "http://127.0.0.1:3025");
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error("Acceptance is local-development only");
const socketId = values.get("--socket-id") ?? "weapon_hand_right";
const outRoot = resolve(values.get("--out-root") ?? "storage/aic-runs/aic-mcp-acceptance");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(outRoot, `${stamp}-${process.pid}`);
mkdirSync(outRoot, { recursive: true });
mkdirSync(out, { recursive: false });

let requestId = 1;
const receipts: ToolReceipt[] = [];

function parseEnvelope(body: string): any {
  const dataLines = body.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const payload = dataLines.length ? dataLines[dataLines.length - 1]!.slice(6) : body;
  return JSON.parse(payload);
}

function parseTextContent(envelope: any): any {
  const text = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function mcp(name: string, args: Record<string, unknown>, expectError = false): Promise<any> {
  const started = performance.now();
  const response = await fetch(new URL("/mcp", base), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  const envelope = parseEnvelope(body);
  const isError = !response.ok || Boolean(envelope.error) || Boolean(envelope.result?.isError);
  const receipt: ToolReceipt = {
    sequence: receipts.length + 1,
    tool: name,
    arguments: args,
    elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
    responseBytes: Buffer.byteLength(body, "utf8"),
    httpStatus: response.status,
    isError,
    value: parseTextContent(envelope),
    envelope,
  };
  receipts.push(receipt);
  console.log(JSON.stringify({ sequence: receipt.sequence, tool: name, elapsedMs: receipt.elapsedMs, responseBytes: receipt.responseBytes, isError }));
  if (isError !== expectError) throw new Error(`${name}: ${expectError ? "expected an error" : "unexpected error"}: ${JSON.stringify(envelope)}`);
  return receipt.value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Acceptance assertion failed: ${message}`);
}

let status = "failed";
let acceptanceSummary: Record<string, unknown> = {};
try {
  const firstPage = await mcp("aic_get_project_summary", {
    projectId, boneOffset: 0, boneLimit: 2, attachmentOffset: 0, attachmentLimit: 2,
  });
  assert(firstPage?.projectId === projectId, "summary projectId mismatch");
  assert(firstPage?.revision === expectedRevision, `expected revision ${expectedRevision}, got ${firstPage?.revision}`);
  assert(firstPage?.skeleton && firstPage?.binding, "summary must include skeleton and binding");
  assert(firstPage.skeleton.boneOffset === 0 && firstPage.skeleton.boneLimit === 2, "bone page fields missing or incorrect");
  assert(firstPage.binding.attachmentOffset === 0 && firstPage.binding.attachmentLimit === 2, "attachment page fields missing or incorrect");
  assert(Number.isInteger(firstPage.skeleton.boneCount) && typeof firstPage.skeleton.bonesTruncated === "boolean", "bone page total/truncation schema invalid");
  assert(Number.isInteger(firstPage.binding.attachmentCount) && typeof firstPage.binding.attachmentsTruncated === "boolean", "attachment page total/truncation schema invalid");

  const secondPage = await mcp("aic_get_project_summary", {
    projectId, boneOffset: 2, boneLimit: 2, attachmentOffset: 2, attachmentLimit: 2,
  });
  assert(secondPage?.revision === expectedRevision, "second summary page revision mismatch");
  assert(secondPage.skeleton.boneOffset === 2 && secondPage.binding.attachmentOffset === 2, "second summary page offsets mismatch");
  const firstBoneIds = firstPage.skeleton.bones.map((bone: any) => bone.id);
  const secondBoneIds = secondPage.skeleton.bones.map((bone: any) => bone.id);
  assert(!secondBoneIds.some((id: string) => firstBoneIds.includes(id)), "bone pages overlap");
  const firstAttachmentIds = firstPage.binding.attachments.map((attachment: any) => attachment.id);
  const secondAttachmentIds = secondPage.binding.attachments.map((attachment: any) => attachment.id);
  assert(!secondAttachmentIds.some((id: string) => firstAttachmentIds.includes(id)), "attachment pages overlap");

  const expectedActions = ["idle", "attack", "hit", "death"];
  const actions = new Map(firstPage.actions.map((action: any) => [action.id, action]));
  for (const actionId of expectedActions) {
    const action: any = actions.get(actionId);
    assert(action, `missing action ${actionId}`);
    assert(typeof action.speed === "number" && Number.isInteger(action.repeat) && typeof action.loop === "boolean" && typeof action.clipLoop === "boolean", `action playback schema invalid: ${actionId}`);
  }
  const profiles = firstPage.bodyProfiles;
  assert(Array.isArray(profiles) && profiles.length === 1, "expected exactly one BodyProfile for socket acceptance");
  const bodyProfileId = profiles[0].id;
  const boneIds = ["hand_right", "root", "chest"];
  const poses: Record<string, Record<string, any>> = {};
  for (const actionId of expectedActions) {
    poses[actionId] = {};
    for (const timeSeconds of [0, 0.3]) {
      const pose = await mcp("aic_sample_pose", { projectId, actionId, timeSeconds, boneIds, socketIds: [socketId], bodyProfileId });
      assert(pose?.revision === expectedRevision, `${actionId}@${timeSeconds} revision mismatch`);
      assert(pose?.action?.id === actionId && pose?.action?.resolvedBy === "id", `${actionId}@${timeSeconds} action resolution mismatch`);
      assert(pose?.bones?.length === boneIds.length, `${actionId}@${timeSeconds} bone count mismatch`);
      assert(pose?.sockets?.length === 1 && pose.sockets[0].id === socketId, `${actionId}@${timeSeconds} socket mismatch`);
      assert(Number.isFinite(pose.scaledActionTimeSeconds) && Number.isFinite(pose.clipTimeSeconds), `${actionId}@${timeSeconds} time mapping invalid`);
      poses[actionId][String(timeSeconds)] = pose;
    }
  }

  const unknownBone = `unknown-bone-${crypto.randomUUID()}`;
  const negative = await mcp("aic_sample_pose", { projectId, actionId: "idle", timeSeconds: 0, boneIds: [unknownBone] }, true);
  assert(negative?.code === "POSE_UNKNOWN_BONE", `unknown bone returned ${negative?.code ?? "no stable code"}`);

  status = "passed";
  acceptanceSummary = {
    status,
    claim: "Read-only MCP numeric pose acceptance; not visual-quality or terminal-client acceptance.",
    baseUrl: base.origin,
    projectId,
    revision: expectedRevision,
    bodyProfileId,
    socketId,
    boneIds,
    actions: expectedActions,
    sampleTimesSeconds: [0, 0.3],
    summaryPagination: {
      boneCount: firstPage.skeleton.boneCount,
      attachmentCount: firstPage.binding.attachmentCount,
      firstBoneIds,
      secondBoneIds,
      firstAttachmentIds,
      secondAttachmentIds,
    },
    negative: { unknownBone, code: negative.code, message: negative.message },
    calls: receipts.map(({ envelope: _envelope, value: _value, ...metric }) => metric),
    totals: {
      calls: receipts.length,
      elapsedMs: Math.round(receipts.reduce((sum, item) => sum + item.elapsedMs, 0) * 1000) / 1000,
      responseBytes: receipts.reduce((sum, item) => sum + item.responseBytes, 0),
    },
  };
  writeFileSync(join(out, "numeric-evidence.json"), JSON.stringify({ ...acceptanceSummary, summaries: { firstPage, secondPage }, poses, negative, receipts }, null, 2), { flag: "wx" });
  writeFileSync(join(out, "summary.json"), JSON.stringify(acceptanceSummary, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status, evidenceDirectory: out, summary: join(out, "summary.json"), numericEvidence: join(out, "numeric-evidence.json"), totals: acceptanceSummary.totals }));
} catch (error) {
  acceptanceSummary = {
    status,
    claim: "Read-only MCP numeric pose acceptance failed before completion.",
    baseUrl: base.origin,
    projectId,
    expectedRevision,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    receipts,
  };
  writeFileSync(join(out, "failure.json"), JSON.stringify(acceptanceSummary, null, 2), { flag: "wx" });
  console.error(JSON.stringify({ status, evidenceDirectory: out, failure: join(out, "failure.json") }));
  throw error;
}

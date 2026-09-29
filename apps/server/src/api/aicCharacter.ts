import { Elysia, t } from "elysia";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AicError, applyAicOperations, getAicDiagnostics, getAicSummary, publishAicV3, sampleAicPose, AIC_CAPABILITIES, type AicOperation } from "../aicCharacter";
import { STORAGE_ROOT } from "../db";

function failure(error: unknown, status: (code: number, message: string) => unknown) {
  if (error instanceof AicError) return status(error.status, JSON.stringify({ code: error.code, message: error.message, details: error.details }));
  return status(500, (error as Error).message);
}

export const aicCharacterApi = new Elysia({ prefix: "/api" })
  .get("/aic/capabilities", () => ({ capabilities: AIC_CAPABILITIES }))
  .get("/projects/:id/aic-summary", ({ params, query, status }) => {
    try {
      return { summary: getAicSummary(params.id, { boneId: query.boneId, attachmentId: query.attachmentId, actionId: query.actionId, targetId: query.targetId, startTime: query.startTime === undefined ? undefined : Number(query.startTime), endTime: query.endTime === undefined ? undefined : Number(query.endTime), boneOffset: query.boneOffset === undefined ? undefined : Number(query.boneOffset), boneLimit: query.boneLimit === undefined ? undefined : Number(query.boneLimit), attachmentOffset: query.attachmentOffset === undefined ? undefined : Number(query.attachmentOffset), attachmentLimit: query.attachmentLimit === undefined ? undefined : Number(query.attachmentLimit) }) };
    } catch (error) { return failure(error, status); }
  }, { query: t.Object({ boneId: t.Optional(t.String()), attachmentId: t.Optional(t.String()), actionId: t.Optional(t.String()), targetId: t.Optional(t.String()), startTime: t.Optional(t.String()), endTime: t.Optional(t.String()), boneOffset: t.Optional(t.String()), boneLimit: t.Optional(t.String()), attachmentOffset: t.Optional(t.String()), attachmentLimit: t.Optional(t.String()) }) })
  .get("/projects/:id/aic-pose", ({ params, query, status }) => {
    try {
      const parseIds = (value: string | undefined) => value === undefined || value === "" ? undefined : value.split(",").map((item) => item.trim());
      return { pose: sampleAicPose(params.id, { actionId: query.actionId, timeSeconds: Number(query.timeSeconds), boneIds: parseIds(query.boneIds), socketIds: parseIds(query.socketIds), bodyProfileId: query.bodyProfileId }) };
    } catch (error) { return failure(error, status); }
  }, { query: t.Object({ actionId: t.String(), timeSeconds: t.String(), boneIds: t.Optional(t.String()), socketIds: t.Optional(t.String()), bodyProfileId: t.Optional(t.String()) }) })
  .get("/projects/:id/aic-diagnostics", ({ params, status }) => {
    try { return getAicDiagnostics(params.id); } catch (error) { return failure(error, status); }
  })
  .post("/projects/:id/aic-operations", async ({ params, body, status }) => {
    try {
      return await applyAicOperations(params.id, body.baseRevision, body.idempotencyKey, body.operations as AicOperation[]);
    } catch (error) { return failure(error, status); }
  }, { body: t.Object({ baseRevision: t.Integer({ minimum: 0 }), idempotencyKey: t.String({ minLength: 1, maxLength: 200 }), operations: t.Array(t.Any(), { minItems: 1, maxItems: 64 }) }) })
  .post("/projects/:id/aic-publish-v3", async ({ params, status }) => {
    try { return await publishAicV3(params.id); } catch (error) { return failure(error, status); }
  })
  .get("/aic-artifacts/:name", ({ params, status }) => {
    if (!/^[a-f0-9]{64}\.fbanim$/.test(params.name)) return status(400, "artifactId 无效");
    const path = join(STORAGE_ROOT, "aic-published", params.name);
    if (!existsSync(path)) return status(404, "发布产物不存在");
    return new Response(readFileSync(path), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${params.name}"`, "Cache-Control": "public, max-age=31536000, immutable" } });
  });

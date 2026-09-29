import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { AicError, AIC_CAPABILITIES, applyAicOperations, getAicDiagnostics, getAicSummary, publishAicV3, sampleAicPose, type AicOperation } from "../../aicCharacter";
import { err, ok } from "../helpers";

function call<T>(fn: () => T): any {
  try { return fn(); } catch (error) { return error instanceof AicError ? err(JSON.stringify({ code: error.code, message: error.message, details: error.details })) : err((error as Error).message); }
}

export function register(server: McpServer) {
  server.registerTool("aic_get_capabilities", { title: "AIC Capabilities", description: "Get the FrameBaker AI-character capability snapshot and explicit v3 rejection boundaries.", inputSchema: z.object({}), annotations: { readOnlyHint: true, idempotentHint: true } }, async () => ok({ capabilities: AIC_CAPABILITIES }));
  server.registerTool("aic_get_project_summary", { title: "AIC Project Summary", description: "Read a bounded structured summary of a skeletal project. Use entity, pagination, and time filters before requesting detailed tracks.", inputSchema: z.object({ projectId: z.string(), boneId: z.string().optional(), attachmentId: z.string().optional(), actionId: z.string().optional(), targetId: z.string().optional(), startTime: z.number().optional(), endTime: z.number().optional(), boneOffset: z.number().int().min(0).max(4096).optional(), boneLimit: z.number().int().min(0).max(256).optional(), attachmentOffset: z.number().int().min(0).max(4096).optional(), attachmentLimit: z.number().int().min(0).max(256).optional() }), annotations: { readOnlyHint: true, idempotentHint: true } }, async (input): Promise<any> => {
    const result = call(() => getAicSummary(input.projectId, input));
    return "content" in result ? result : ok(result);
  });
  server.registerTool("aic_get_diagnostics", { title: "AIC Diagnostics", description: "Run bounded structural and v3 capability diagnostics for a skeletal project.", inputSchema: { projectId: z.string() }, annotations: { readOnlyHint: true, idempotentHint: true } }, async ({ projectId }): Promise<any> => {
    const result = call(() => getAicDiagnostics(projectId));
    return "content" in result ? result : ok(result);
  });
  server.registerTool("aic_sample_pose", { title: "AIC Sample Pose", description: "Sample a bound Region skeleton at a non-negative action time in seconds using shared motion interpolation and forward-kinematics math. action.speed is applied; action.loop/repeat control playback lifetime while clip.loop is reported separately. actionId resolves an exact ID first, then a unique name; ambiguous names and unknown IDs are rejected. The response names clipTimeSeconds and returns a bounded set of bone/socket matrices. Specify bodyProfileId when selecting sockets in projects with multiple profiles.", inputSchema: z.object({ projectId: z.string(), actionId: z.string(), timeSeconds: z.number().finite().min(0), boneIds: z.array(z.string()).max(128).optional(), socketIds: z.array(z.string()).max(128).optional(), bodyProfileId: z.string().optional() }), annotations: { readOnlyHint: true, idempotentHint: true } }, async (input): Promise<any> => {
    const result = call(() => sampleAicPose(input.projectId, input));
    return "content" in result ? result : ok(result);
  });
  server.registerTool("aic_apply_operations", { title: "AIC Apply Operations", description: "Atomically create or edit skeleton, binding, BodyProfile, equipment, MotionClip and keyframes. Requires baseRevision and an idempotency key.", inputSchema: z.object({ projectId: z.string(), baseRevision: z.number().int().min(0), idempotencyKey: z.string().min(1).max(200), operations: z.array(z.any()).min(1).max(64) }), annotations: { readOnlyHint: false, idempotentHint: true } }, async ({ projectId, baseRevision, idempotencyKey, operations }) => {
    try { return ok(await applyAicOperations(projectId, baseRevision, idempotencyKey, operations as AicOperation[])); } catch (error) { return error instanceof AicError ? err(JSON.stringify({ code: error.code, message: error.message, details: error.details })) : err((error as Error).message); }
  });
  server.registerTool("aic_publish_v3", { title: "AIC Publish v3", description: "Run the same shared v3 builder used by FrameBaker publishing and return manifest plus bounded entry digests. runtimeWarp and meshSkinning remain rejected.", inputSchema: z.object({ projectId: z.string() }), annotations: { readOnlyHint: true, idempotentHint: true } }, async ({ projectId }) => {
    try { return ok(await publishAicV3(projectId)); } catch (error) { return error instanceof AicError ? err(JSON.stringify({ code: error.code, message: error.message, details: error.details })) : err((error as Error).message); }
  });
}

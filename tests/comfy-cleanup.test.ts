import { describe, expect, test } from "bun:test";
import { cleanupComfyRuntime, normalizeComfyEndpoint } from "../apps/server/src/mediaPlugins/comfyCleanup";

describe("Comfy 共享模型卸载门禁", () => {
  test("端点规范化，拒绝凭据/查询/非 HTTP", () => {
    expect(normalizeComfyEndpoint("http://LOCALHOST:8188/")).toBe("http://localhost:8188");
    for (const url of ["file:///a", "http://user:secret@localhost:8188", "http://localhost/?token=x"]) expect(() => normalizeComfyEndpoint(url)).toThrow();
  });
  test("200 不等于已卸载，等待连续两次可观测释放", async () => {
    let time = 0; let reads = 0; const paths: string[] = [];
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path === "/free") { expect(JSON.parse(String(init?.body))).toEqual({unload_models:true,free_memory:true}); return new Response(null,{status:200}); }
      if (path === "/queue") return Response.json({queue_running:[],queue_pending:[]});
      return Response.json({devices:[{torch_vram_total:++reads < 3 ? 4e9 : 0}]});
    }) as typeof fetch;
    const result = await cleanupComfyRuntime("http://localhost:8188",{fetchImpl:fake,now:()=>time,sleep:async(ms)=>{time+=ms;}});
    expect(result.ok).toBe(true); expect(reads).toBe(4); expect(paths.filter(p=>p==="/free")).toHaveLength(1);
  });
  test("不取消未知任务，也不发送卸载", async () => {
    let calls=0;
    const fake=(async()=>{calls++; return Response.json({queue_running:[[1,"other-job"]],queue_pending:[]});}) as unknown as typeof fetch;
    expect((await cleanupComfyRuntime("http://localhost:8188",{fetchImpl:fake})).ok).toBe(false); expect(calls).toBe(1);
  });
  test("显存观测缺失或始终未释放时 fail closed", async () => {
    for (const device of [{}, {torch_vram_total:10e9}]) {
      let time=0;
      const fake=(async(input:string|URL|Request)=>new URL(String(input)).pathname==="/queue"?Response.json({queue_running:[],queue_pending:[]}):new URL(String(input)).pathname==="/free"?new Response(null):Response.json({devices:[device]})) as typeof fetch;
      expect((await cleanupComfyRuntime("http://localhost:8188",{fetchImpl:fake,timeoutMs:20,pollMs:5,now:()=>time,sleep:async(ms)=>{time+=ms;}})).ok).toBe(false);
    }
  });
});

/**
 * Best-effort process-tree termination for media-plugin Python runners.
 *
 * Bun.spawn().kill() only signals the direct child. On Windows, Python may spawn
 * grandchildren that outlive a single kill(); when a numeric PID is available we
 * additionally run `taskkill /PID <pid> /T /F` to terminate the tree. On POSIX we
 * still rely on Bun's kill (typically SIGTERM). Callers must treat this as
 * best-effort — Bun does not expose a portable process-group kill API.
 */
export function terminateSpawnedProcessTree(proc: {
  pid?: number | null;
  kill: (...args: any[]) => void;
}): void {
  try {
    proc.kill();
  } catch {
    /* already exited */
  }

  if (process.platform !== "win32") return;
  const pid = typeof proc.pid === "number" && Number.isFinite(proc.pid) && proc.pid > 0 ? proc.pid : null;
  if (pid == null) return;
  try {
    Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
  } catch {
    /* best-effort */
  }
}

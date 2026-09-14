/** 时间轴格数 → 秒。fps 为播放密度；duration 仍是格数。 */
export function frameDurationSeconds(durationTicks: number, fps: number): number {
  return durationTicks / Math.max(1, fps);
}

export type FrameExportCell = {
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  duration: number;
  durationSeconds: number;
  frameIds: string[];
  effectIds: string[];
};

export function buildFrameExportCell(
  cell: Omit<FrameExportCell, "durationSeconds">,
  fps: number,
): FrameExportCell {
  return {
    ...cell,
    durationSeconds: frameDurationSeconds(cell.duration, fps),
  };
}

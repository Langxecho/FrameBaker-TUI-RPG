import { createImage, type RgbaImage } from "./png";

export interface PaletteEntry { name: string; key: string; rgb: [number, number, number] }

/** 美术包 `_task.json` 中检查所需的字段（其余字段原样保留，不在此声明）。 */
export interface TaskSprite {
  sprite_id: string;
  sprite_png: string;
  psd?: string;
  required?: boolean;
  native_size: [number, number];
  rig_size: [number, number];
  pivot: [number, number];
  pivot_px?: [number, number];
  problem_box?: [number, number, number, number];
  open_edge_pixels?: Array<[number, number]>;
}

export interface ArtTask {
  task_id: string;
  palette: PaletteEntry[];
  sprites: TaskSprite[];
}

export interface OpenEdgeBand {
  /** [x0, y0, x1, y1]，含端点。 */
  band: [number, number, number, number];
  /** 切口朝向：带内轮廓像素只有在这一侧邻接透明时才豁免。 */
  side: "left" | "right" | "top" | "bottom";
}

export interface CheckOptions {
  openEdgeBand?: OpenEdgeBand;
  /** 额外豁免像素（如美术移动了切口后由对接师给出的蒙版）。 */
  extraOpenEdge?: Array<[number, number]>;
  /** 开包时的起点图，用于统计改动量。 */
  starter?: RgbaImage;
  outlineRgb?: [number, number, number];
}

export interface CheckReport {
  spriteId: string;
  verdict: "PASS" | "FAIL";
  size: { expected: [number, number]; actual: [number, number]; ok: boolean };
  opaquePixels: number;
  bbox: [number, number, number, number] | null;
  semiTransparent: Array<[number, number]>;
  offPalette: Array<{ x: number; y: number; rgb: [number, number, number] }>;
  outlineBreaks: Array<[number, number]>;
  openEdgeExempt: number;
  pivot: { fb: [number, number]; pxFromTop: [number, number] | null; consistent: boolean | null };
  starterDelta: { changed: number; insideProblemBox: number; outsideProblemBox: number } | null;
  failures: string[];
}

const OUTLINE: [number, number, number] = [9, 5, 9];
const NEIGHBORS: Array<[number, number, OpenEdgeBand["side"]]> = [[-1, 0, "left"], [1, 0, "right"], [0, -1, "top"], [0, 1, "bottom"]];

export function findSprite(task: ArtTask, spriteId?: string): TaskSprite {
  if (!spriteId) {
    const required = task.sprites.find((sprite) => sprite.required !== false);
    if (!required) throw new Error(`${task.task_id} 没有必交 sprite`);
    return required;
  }
  const sprite = task.sprites.find((item) => item.sprite_id === spriteId);
  if (!sprite) throw new Error(`${task.task_id} 中没有 sprite「${spriteId}」；可选：${task.sprites.map((item) => item.sprite_id).join("、")}`);
  return sprite;
}

function inBox(x: number, y: number, box: readonly number[]): boolean {
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

/** 按美术包合同检查交回的图层：尺寸、半透明、色板、外露轮廓 RGB(9,5,9)，open_edge 切口豁免。 */
export function checkSprite(image: RgbaImage, task: ArtTask, sprite: TaskSprite, options: CheckOptions = {}): CheckReport {
  const [ew, eh] = sprite.native_size;
  const sizeOk = image.width === ew && image.height === eh;
  const outline = options.outlineRgb ?? OUTLINE;
  const palette = new Set(task.palette.map((entry) => entry.rgb.join(",")));
  palette.add(outline.join(","));
  const exempt = new Set([...(sprite.open_edge_pixels ?? []), ...(options.extraOpenEdge ?? [])].map(([x, y]) => `${x},${y}`));
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= image.width || y >= image.height ? 0 : image.data[(y * image.width + x) * 4 + 3]);

  const semiTransparent: Array<[number, number]> = [];
  const offPalette: CheckReport["offPalette"] = [];
  const outlineBreaks: Array<[number, number]> = [];
  let opaquePixels = 0, openEdgeExempt = 0;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const o = (y * image.width + x) * 4;
      const a = image.data[o + 3];
      if (a === 0) continue;
      if (a < 255) { semiTransparent.push([x, y]); continue; }
      opaquePixels += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const rgb: [number, number, number] = [image.data[o], image.data[o + 1], image.data[o + 2]];
      if (!palette.has(rgb.join(","))) offPalette.push({ x, y, rgb });
      const openSides = NEIGHBORS.filter(([dx, dy]) => alpha(x + dx, y + dy) < 255).map(([, , side]) => side);
      if (openSides.length === 0) continue;
      if (rgb[0] === outline[0] && rgb[1] === outline[1] && rgb[2] === outline[2]) continue;
      const band = options.openEdgeBand;
      if (exempt.has(`${x},${y}`) || (band && inBox(x, y, band.band) && openSides.every((side) => side === band.side))) { openEdgeExempt += 1; continue; }
      outlineBreaks.push([x, y]);
    }
  }

  let starterDelta: CheckReport["starterDelta"] = null;
  if (options.starter && options.starter.width === image.width && options.starter.height === image.height) {
    let changed = 0, inside = 0;
    for (let i = 0; i < image.width * image.height; i += 1) {
      const o = i * 4;
      const same = image.data[o + 3] === 0 && options.starter.data[o + 3] === 0
        || (image.data[o] === options.starter.data[o] && image.data[o + 1] === options.starter.data[o + 1] && image.data[o + 2] === options.starter.data[o + 2] && image.data[o + 3] === options.starter.data[o + 3]);
      if (same) continue;
      changed += 1;
      if (sprite.problem_box && inBox(i % image.width, Math.floor(i / image.width), sprite.problem_box)) inside += 1;
    }
    starterDelta = { changed, insideProblemBox: inside, outsideProblemBox: changed - inside };
  }

  const pxFromTop = sprite.pivot_px ?? null;
  const consistent = pxFromTop ? Math.abs(pxFromTop[0] / ew - sprite.pivot[0]) < 0.01 && Math.abs(1 - pxFromTop[1] / eh - sprite.pivot[1]) < 0.01 : null;

  const failures: string[] = [];
  if (!sizeOk) failures.push(`尺寸 ${image.width}×${image.height} ≠ 合同 ${ew}×${eh}`);
  if (semiTransparent.length) failures.push(`${semiTransparent.length} 个半透明像素（alpha 只能是 0 或 255）`);
  if (offPalette.length) failures.push(`${offPalette.length} 个色板外像素`);
  if (outlineBreaks.length) failures.push(`${outlineBreaks.length} 处外露轮廓不是 RGB(${outline.join(",")})`);
  if (opaquePixels === 0) failures.push("图层为空");
  if (consistent === false) failures.push("任务 pivot 与 pivot_px 不一致（任务文件本身有误）");

  return {
    spriteId: sprite.sprite_id,
    verdict: failures.length ? "FAIL" : "PASS",
    size: { expected: [ew, eh], actual: [image.width, image.height], ok: sizeOk },
    opaquePixels,
    bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
    semiTransparent,
    offPalette,
    outlineBreaks,
    openEdgeExempt,
    pivot: { fb: sprite.pivot, pxFromTop, consistent },
    starterDelta,
    failures,
  };
}

/** 生成最近邻放大的检查叠加图：橙=半透明，红=轮廓断口，青=色板外，品红十字=pivot。 */
export function renderCheckOverlay(image: RgbaImage, report: CheckReport, sprite: TaskSprite, scale = 12): RgbaImage {
  const out = createImage(image.width * scale, image.height * scale);
  const paint = (x: number, y: number, rgb: [number, number, number]) => {
    for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
      const o = ((y * scale + dy) * out.width + x * scale + dx) * 4;
      out.data[o] = rgb[0]; out.data[o + 1] = rgb[1]; out.data[o + 2] = rgb[2]; out.data[o + 3] = 255;
    }
  };
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const o = (y * image.width + x) * 4;
    const checker: [number, number, number] = (x + y) % 2 ? [96, 96, 104] : [128, 128, 136];
    const a = image.data[o + 3] / 255;
    paint(x, y, [0, 1, 2].map((c) => Math.round(image.data[o + c] * a + checker[c] * (1 - a))) as [number, number, number]);
  }
  for (const [x, y] of report.semiTransparent) paint(x, y, [255, 140, 0]);
  for (const { x, y } of report.offPalette) paint(x, y, [0, 220, 255]);
  for (const [x, y] of report.outlineBreaks) paint(x, y, [255, 0, 0]);
  const px = Math.round(sprite.pivot[0] * image.width * scale);
  const py = Math.round((1 - sprite.pivot[1]) * image.height * scale);
  for (let d = -scale; d <= scale; d += 1) {
    for (const [x, y] of [[px + d, py], [px, py + d]]) {
      if (x < 0 || y < 0 || x >= out.width || y >= out.height) continue;
      const o = (y * out.width + x) * 4;
      out.data[o] = 255; out.data[o + 1] = 0; out.data[o + 2] = 255; out.data[o + 3] = 255;
    }
  }
  return out;
}

/** 入库用的规范化 PNG：只保留 alpha=0/255 判定后的像素（检查 PASS 后调用，原样输出）。 */
export function normalizedSprite(image: RgbaImage): RgbaImage {
  const out = createImage(image.width, image.height);
  out.data.set(image.data);
  for (let i = 0; i < image.width * image.height; i += 1) if (out.data[i * 4 + 3] === 0) { out.data[i * 4] = 0; out.data[i * 4 + 1] = 0; out.data[i * 4 + 2] = 0; }
  return out;
}

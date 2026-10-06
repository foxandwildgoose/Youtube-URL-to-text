import type { Corners, Point, Region } from "./types.ts";
export function validCorners(corners: Corners): boolean {
  if (
    corners.some(
      (p) =>
        !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1,
    )
  )
    return false;
  const crosses = corners.map((p, i) => {
    const q = corners[(i + 1) % 4]!;
    const r = corners[(i + 2) % 4]!;
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  return crosses.every((n) => n > 0.0001);
}
export function regionAt(regions: Region[], time: number): Region {
  return (
    [...regions]
      .sort((a, b) => a.time - b.time)
      .filter((r) => r.time <= time)
      .at(-1) ?? regions[0]!
  );
}
export function regionDimensions(
  corners: Corners,
  width: number,
  height: number,
): { width: number; height: number } {
  const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  return {
    width: Math.max(
      1,
      Math.round(Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2]))),
    ),
    height: Math.max(
      1,
      Math.round(Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]))),
    ),
  };
}
/** Inverse homography maps an output unit rectangle onto the original quadrilateral. */
export function perspectiveMap(corners: Corners): (x: number, y: number) => Point {
  if (!validCorners(corners))
    throw new Error("Choose a convex, clockwise slide region with four distinct corners.");
  const uv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const matrix: number[][] = [];
  corners.forEach((p, i) => {
    const [x, y] = uv[i]!;
    matrix.push([x!, y!, 1, 0, 0, 0, -p.x * x!, -p.x * y!, p.x]);
    matrix.push([0, 0, 0, x!, y!, 1, -p.y * x!, -p.y * y!, p.y]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++)
      if (Math.abs(matrix[r]![col]!) > Math.abs(matrix[pivot]![col]!)) pivot = r;
    [matrix[col], matrix[pivot]] = [matrix[pivot]!, matrix[col]!];
    const divisor = matrix[col]![col]!;
    if (Math.abs(divisor) < 1e-10) throw new Error("This perspective region is degenerate.");
    for (let c = col; c < 9; c++) matrix[col]![c]! /= divisor;
    for (let r = 0; r < 8; r++)
      if (r !== col) {
        const scale = matrix[r]![col]!;
        for (let c = col; c < 9; c++) matrix[r]![c]! -= scale * matrix[col]![c]!;
      }
  }
  const h = matrix.map((row) => row[8]!);
  return (x, y) => {
    const d = h[6]! * x + h[7]! * y + 1;
    return { x: (h[0]! * x + h[1]! * y + h[2]!) / d, y: (h[3]! * x + h[4]! * y + h[5]!) / d };
  };
}
function triangle(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  src: Point[],
  dst: Point[],
): void {
  const [a, b, c] = src as [Point, Point, Point];
  const [d, e, f] = dst as [Point, Point, Point];
  const det = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  const coeff = (v1: number, v2: number, v3: number) => [
    (v1 * (b.y - c.y) + v2 * (c.y - a.y) + v3 * (a.y - b.y)) / det,
    (v1 * (c.x - b.x) + v2 * (a.x - c.x) + v3 * (b.x - a.x)) / det,
    (v1 * (b.x * c.y - c.x * b.y) + v2 * (c.x * a.y - a.x * c.y) + v3 * (a.x * b.y - b.x * a.y)) /
      det,
  ];
  const x = coeff(d.x, e.x, f.x),
    y = coeff(d.y, e.y, f.y);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d.x, d.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(f.x, f.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(x[0]!, y[0]!, x[1]!, y[1]!, x[2]!, y[2]!);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}
export function warpFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  corners: Corners,
  width?: number,
): HTMLCanvasElement {
  const size = regionDimensions(corners, sourceWidth, sourceHeight);
  const w = Math.min(size.width, width ?? size.width),
    h = Math.max(1, Math.round((size.height * w) / size.width));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  const map = perspectiveMap(corners);
  // Canvas mesh approximation preserves original evidence and records its method. No generative enhancement.
  const grid = 24;
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++) {
      const uv = [
        { x: x / grid, y: y / grid },
        { x: (x + 1) / grid, y: y / grid },
        { x: (x + 1) / grid, y: (y + 1) / grid },
        { x: x / grid, y: (y + 1) / grid },
      ];
      const src = uv.map((p) => {
        const q = map(p.x, p.y);
        return { x: q.x * sourceWidth, y: q.y * sourceHeight };
      });
      const dst = uv.map((p) => ({ x: p.x * w, y: p.y * h }));
      triangle(ctx, source, [src[0]!, src[1]!, src[2]!], [dst[0]!, dst[1]!, dst[2]!]);
      triangle(ctx, source, [src[0]!, src[2]!, src[3]!], [dst[0]!, dst[2]!, dst[3]!]);
    }
  return out;
}

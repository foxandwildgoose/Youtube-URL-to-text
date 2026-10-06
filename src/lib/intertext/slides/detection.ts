export type Feature = {
  width: number;
  height: number;
  pixels: Uint8Array;
  mean: number;
  sharpness: number;
  black: boolean;
  unobservable: boolean;
};
export type Difference = {
  global: number;
  regional: number;
  motion: boolean;
  changed: boolean;
  uncertain: boolean;
};
export function imageFeature(rgba: Uint8ClampedArray, width: number, height: number): Feature {
  const pixels = new Uint8Array(width * height);
  let sum = 0,
    edge = 0;
  for (let i = 0; i < pixels.length; i++) {
    const n = Math.round(
      rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114,
    );
    pixels[i] = n;
    sum += n;
    if (i % width && i >= width)
      edge += Math.abs(n - pixels[i - 1]!) + Math.abs(n - pixels[i - width]!);
  }
  const mean = sum / pixels.length,
    sharpness = edge / (pixels.length * 2 * 255);
  let variance = 0;
  for (const n of pixels) variance += (n - mean) ** 2;
  return {
    width,
    height,
    pixels,
    mean,
    sharpness,
    black: mean < 9 && variance / pixels.length < 80,
    unobservable: sharpness < 0.002 && variance / pixels.length < 30,
  };
}
export function compareFeatures(a: Feature, b: Feature, sensitivity = 1): Difference {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error("Detection dimensions changed. Correct the ROI and restart at this time.");
  const w = a.width,
    h = a.height,
    exposure = b.mean - a.mean;
  const diffAt = (dx: number, dy: number) => {
    let sum = 0,
      n = 0;
    for (let y = 3; y < h - 3; y += 2)
      for (let x = 3; x < w - 3; x += 2) {
        sum += Math.abs(a.pixels[y * w + x]! - (b.pixels[(y + dy) * w + x + dx]! - exposure));
        n++;
      }
    return sum / (n * 255);
  };
  const original = diffAt(0, 0);
  let best = original,
    shift = { x: 0, y: 0 };
  for (let y = -2; y <= 2; y++)
    for (let x = -2; x <= 2; x++) {
      const d = diffAt(x, y);
      if (d < best) {
        best = d;
        shift = { x, y };
      }
    }
  const totals = new Float64Array(576),
    counts = new Uint32Array(576);
  for (let y = 3; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const i = Math.min(575, Math.floor((y / h) * 24) * 24 + Math.floor((x / w) * 24));
      totals[i]! += Math.abs(
        a.pixels[y * w + x]! - (b.pixels[(y + shift.y) * w + x + shift.x]! - exposure),
      );
      counts[i]!++;
    }
  const regional = Math.max(...totals.map((n, i) => n / (Math.max(1, counts[i]!) * 255)));
  const motion = original > 0.04 && best < original * 0.5;
  return {
    global: best,
    regional,
    motion,
    changed: best > 0.07 / sensitivity || regional > 0.045 / sensitivity,
    uncertain: best > 0.025 / sensitivity || regional > 0.018 / sensitivity || motion,
  };
}
export class StateDetector {
  baseline: Feature | undefined;
  pending: Feature | undefined;
  pendingTime = 0;
  pendingCount = 0;
  readonly sensitivity: number;
  readonly stableSamples: number;
  constructor(sensitivity = 1, stableSamples = 2) {
    this.sensitivity = sensitivity;
    this.stableSamples = stableSamples;
  }
  push(
    feature: Feature,
    time: number,
  ): {
    kind: "same" | "candidate" | "stable" | "black" | "unobservable";
    since: number;
    motion: boolean;
  } {
    if (feature.black) {
      this.pending = undefined;
      this.pendingCount = 0;
      this.baseline = undefined;
      return { kind: "black", since: time, motion: false };
    }
    if (feature.unobservable) {
      this.pending = undefined;
      this.pendingCount = 0;
      this.baseline = undefined;
      return { kind: "unobservable", since: time, motion: false };
    }
    if (!this.baseline) {
      if (!this.pending) {
        this.pending = feature;
        this.pendingTime = time;
        this.pendingCount = 1;
        return { kind: "candidate", since: time, motion: false };
      }
    } else {
      const diff = compareFeatures(this.baseline, feature, this.sensitivity);
      if (diff.motion || (!diff.changed && !diff.uncertain)) {
        this.pending = undefined;
        this.pendingCount = 0;
        return { kind: "same", since: time, motion: diff.motion };
      }
    }
    if (this.pending && !compareFeatures(this.pending, feature, this.sensitivity).changed)
      this.pendingCount++;
    else {
      this.pending = feature;
      this.pendingTime = time;
      this.pendingCount = 1;
    }
    if (this.pendingCount >= this.stableSamples) {
      this.baseline = feature;
      const since = this.pendingTime;
      this.pending = undefined;
      this.pendingCount = 0;
      return { kind: "stable", since, motion: false };
    }
    return { kind: "candidate", since: this.pendingTime, motion: false };
  }
}
export function canvasFeature(canvas: HTMLCanvasElement): Feature {
  const small = document.createElement("canvas");
  small.width = 192;
  // Fixed comparison grid; source/full-resolution evidence retains its actual aspect ratio.
  small.height = 108;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const result = imageFeature(
    ctx.getImageData(0, 0, small.width, small.height).data,
    small.width,
    small.height,
  );
  small.width = 0;
  small.height = 0;
  return result;
}

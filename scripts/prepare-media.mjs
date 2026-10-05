import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, "public", "ffmpeg");
await mkdir(destination, { recursive: true });
for (const asset of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(
    join(root, "node_modules", "@ffmpeg", "core", "dist", "esm", asset),
    join(destination, asset),
  );
}

import { throwIfAborted } from "./media-errors.ts";
/** Sample both ends plus metadata; never read the entire large source into memory. */
export async function fingerprintMedia(file: File, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const size = 65_536;
  const prefix = new TextEncoder().encode(`${file.name}\0${file.size}\0${file.lastModified}\0`);
  const first = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(size, file.size - size)).arrayBuffer());
  const sample = new Uint8Array(prefix.length + first.length + last.length);
  sample.set(prefix);
  sample.set(first, prefix.length);
  sample.set(last, prefix.length + first.length);
  throwIfAborted(signal);
  const digest = await crypto.subtle.digest("SHA-256", sample);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

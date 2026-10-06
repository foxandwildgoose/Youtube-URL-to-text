import { StorageError, transact, withDatabase } from "../storage.ts";
import { ASSET_LIMIT_BYTES, checkAbort, SlideFailure } from "./config.ts";
import type { Job } from "../types.ts";
export function slideLockIdentity(job: Job): string {
  return `slides-source:${job.source?.kind === "upload" ? job.source.fingerprint : job.id}`;
}
export type SlideAsset = {
  id: string;
  jobId: string;
  blob: Blob;
  sizeBytes: number;
  createdAt: number;
};
export async function putAsset(jobId: string, id: string, blob: Blob): Promise<void> {
  if (!jobId || !id || blob.type !== "image/png" || !blob.size || blob.size > 32_000_000)
    throw new StorageError("invalid_history", "Invalid or oversized evidence image.");
  await withDatabase((db) =>
    transact<void>(db, ["slideAssets"], "readwrite", (tx, result, fail) => {
      const store = tx.objectStore("slideAssets");
      let bytes = blob.size;
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        try {
          const current = cursor.result;
          if (current) {
            const asset = current.value as SlideAsset;
            if (asset.id !== id) bytes += asset.sizeBytes;
            current.continue();
          } else if (bytes > ASSET_LIMIT_BYTES)
            fail(
              new StorageError(
                "storage_quota",
                "Selected slide evidence reached the 128 MB local asset guardrail. Keep a text backup and explicitly remove unwanted evidence/history before continuing. No old transcripts were deleted.",
              ),
            );
          else {
            store.put({ id, jobId, blob, sizeBytes: blob.size, createdAt: Date.now() });
            result(undefined);
          }
        } catch (error) {
          fail(error);
        }
      };
    }),
  );
}
export async function getAsset(id: string): Promise<Blob | undefined> {
  return withDatabase((db) =>
    transact<Blob | undefined>(db, ["slideAssets"], "readonly", (tx, result) => {
      const request = tx.objectStore("slideAssets").get(id);
      request.onsuccess = () => result((request.result as SlideAsset | undefined)?.blob);
    }),
  );
}
export async function removeAsset(id: string): Promise<void> {
  return withDatabase((db) =>
    transact<void>(db, ["slideAssets"], "readwrite", (tx, result) => {
      tx.objectStore("slideAssets").delete(id);
      result(undefined);
    }),
  );
}
/** Atomic lease supplements Web Locks in browsers without that API. Not account-wide billing deduplication. */
export async function acquireLease(id: string, owner: string, now = Date.now()): Promise<boolean> {
  return withDatabase((db) =>
    transact<boolean>(db, ["slideLeases"], "readwrite", (tx, result) => {
      const store = tx.objectStore("slideLeases");
      const request = store.get(id);
      request.onsuccess = () => {
        const lease = request.result as { owner: string; expires: number } | undefined;
        if (lease && lease.owner !== owner && lease.expires > now) result(false);
        else {
          store.put({ id, owner, expires: now + 120_000 });
          result(true);
        }
      };
    }),
  );
}
export async function releaseLease(id: string, owner: string): Promise<void> {
  await withDatabase((db) =>
    transact<void>(db, ["slideLeases"], "readwrite", (tx, result) => {
      const store = tx.objectStore("slideLeases");
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result?.owner === owner) store.delete(id);
        result(undefined);
      };
    }),
  );
}
export async function withSlideLock<T>(
  id: string,
  signal: AbortSignal,
  action: (leaseCheck: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const run = async () => {
    const owner = crypto.randomUUID();
    if (!(await acquireLease(id, owner)))
      throw new SlideFailure(
        "Another tab is processing this recording. Return to that tab or wait for its lease to expire.",
        "tab_locked",
      );
    const check = async () => {
      checkAbort(signal);
      if (!(await acquireLease(id, owner)))
        throw new SlideFailure(
          "This tab lost its processing lease. No further model call was started.",
          "tab_locked",
        );
    };
    try {
      return await action(check);
    } finally {
      await releaseLease(id, owner);
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(`intertext-slides:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) throw new SlideFailure("Another tab is processing this job.", "tab_locked");
      return run();
    });
  return run();
}

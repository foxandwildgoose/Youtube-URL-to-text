import assert from "node:assert/strict";
import { beforeEach, afterEach, describe, it } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  saveJob,
  loadJobs,
  exportBackup,
  importBackup,
  deleteJob,
  StorageError,
} from "../storage.ts";
import { acquireLease, getAsset, putAsset, releaseLease } from "./assets.ts";
import { testJob } from "./test-fixtures.ts";
describe("visual migration/assets/leases", () => {
  const previous = globalThis.indexedDB;
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = previous;
  });
  it("upgrades a version-1 database without losing existing captions or edits", async () => {
    const old = {
      ...testJob(),
      id: "legacy",
      processingMode: undefined,
      slides: undefined,
      sourceType: "manual" as const,
      source: {
        kind: "youtube" as const,
        videoId: "abcdefghijk",
        url: "https://youtube.com/watch?v=abcdefghijk",
      },
      summary: "manual old summary",
      paragraphs: [{ start: 0, duration: 2, text: "old edited 한국어" }],
      segments: [{ start: 0, duration: 2, text: "original" }],
    };
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("intertext", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("jobs", { keyPath: "id" });
        r.result.createObjectStore("settings", { keyPath: "key" });
      };
      r.onsuccess = () => {
        const tx = r.result.transaction("jobs", "readwrite");
        tx.objectStore("jobs").put(old);
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
      r.onerror = () => reject(r.error);
    });
    await saveJob(testJob());
    const jobs = await loadJobs();
    assert.equal(jobs.length, 2);
    assert.equal(jobs.find((j) => j.id === "legacy")!.paragraphs[0]!.text, "old edited 한국어");
    assert.equal(jobs.find((j) => j.id === "legacy")!.summary, "manual old summary");
  });
  it("stores PNG Blobs separately and exports only text backup version 2", async () => {
    const job = testJob();
    await saveJob(job);
    await putAsset(job.id!, "image", new Blob(["PNG bytes"], { type: "image/png" }));
    assert.equal((await getAsset("image"))!.size, 9);
    const backup = await exportBackup();
    assert.equal(JSON.parse(backup).version, 2);
    assert(!backup.includes("PNG bytes"));
    await importBackup(backup);
    assert.deepEqual((await loadJobs())[0]!.slides, job.slides);
    await assert.rejects(
      saveJob({ ...job, slides: { ...job.slides!, blob: new Blob(["bad"]) } as typeof job.slides }),
      StorageError,
    );
  });
  it("continues importing backup version 1 without destructive migration", async () => {
    const old = {
      ...testJob(),
      id: "old",
      processingMode: undefined,
      slides: undefined,
      sourceType: "manual" as const,
      source: {
        kind: "youtube" as const,
        videoId: "abcdefghijk",
        url: "https://youtube.com/watch?v=abcdefghijk",
      },
    };
    await importBackup({
      format: "intertext-backup",
      version: 1,
      jobs: [old],
      settings: {},
      exportedAt: "2026-01-01",
    });
    await saveJob(testJob());
    assert.equal((await loadJobs()).length, 2);
  });
  it("surfaces quota failure and retains old history", async () => {
    await saveJob(testJob());
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "slideAssets") throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
    try {
      await assert.rejects(
        putAsset("visual-job", "image", new Blob(["png"], { type: "image/png" })),
        (e: unknown) => e instanceof StorageError && e.code === "storage_quota",
      );
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    assert.equal((await loadJobs()).length, 1);
  });
  it("prevents duplicate tab processing with atomic expiring leases", async () => {
    assert(await acquireLease("job", "tab1", 100));
    assert.equal(await acquireLease("job", "tab2", 101), false);
    assert(await acquireLease("job", "tab1", 102));
    await releaseLease("job", "tab2");
    assert.equal(await acquireLease("job", "tab2", 103), false);
    assert(await acquireLease("job", "tab2", 122_000));
    await releaseLease("job", "tab2");
    assert(await acquireLease("job", "tab1", 122_001));
  });
  it("deletes only the chosen job and its evidence", async () => {
    await saveJob(testJob());
    await putAsset("visual-job", "frame", new Blob(["png"], { type: "image/png" }));
    await putAsset("other", "other-frame", new Blob(["png"], { type: "image/png" }));
    await deleteJob("visual-job");
    assert.equal(await getAsset("frame"), undefined);
    assert(await getAsset("other-frame"));
  });
});

import type { Job, SummaryKind } from "./types.ts";
import { isSummaryKind } from "./types.ts";

const DATABASE = "intertext";
const VERSION = 1;
const LEGACY_KEYS = ["intertext.jobs.v1", "intertext.jobs.v2"] as const;
const INTERNAL_PREFIX = "__intertext_";

export type StorageErrorCode =
  "storage_unavailable" | "storage_quota" | "storage_failed" | "invalid_history" | "invalid_backup";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}

type SettingRecord = { key: string; value: unknown };
export type IntertextBackup = {
  format: "intertext-backup";
  version: 1;
  exportedAt: string;
  jobs: Job[];
  settings: Record<string, unknown>;
};

function storageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "QuotaExceededError") {
    return new StorageError(
      "storage_quota",
      "Browser storage is full. Export a backup or remove history you no longer need, then retry. Your existing history was kept.",
      { cause: error },
    );
  }
  if (name === "SecurityError" || name === "InvalidStateError") {
    return new StorageError(
      "storage_unavailable",
      "This browser is blocking local transcript storage. Allow site storage to save and resume jobs.",
      { cause: error },
    );
  }
  return new StorageError(
    "storage_failed",
    "Transcript history could not be saved or read. Your existing history was kept; retry before closing this page.",
    { cause: error },
  );
}

function invalid(
  message: string,
  code: "invalid_backup" | "invalid_history" = "invalid_history",
): never {
  throw new StorageError(code, message);
}

/** Explicit IDs support repeated processing of the same upload. Old YouTube IDs remain stable. */
export function jobIdentity(job: Job): string {
  if (typeof job.id === "string" && job.id.trim()) return job.id;
  const videoId = job.source?.kind === "youtube" ? job.source.videoId : job.videoId;
  if (videoId) return `youtube:${videoId}:${job.language}`;
  if (job.source?.kind === "upload") {
    const source = job.source;
    const fingerprint =
      source.fingerprint || `${source.fileName}:${source.sizeBytes}:${source.lastModified}`;
    return `upload:${fingerprint}:${job.createdAt}`;
  }
  return invalid("A transcript job needs a source or a stable job ID.");
}

function normalizeJob(job: Job): Job {
  const kind: SummaryKind = isSummaryKind(String(job.summaryKind ?? ""))
    ? job.summaryKind
    : "general";
  const source =
    job.source ??
    (job.videoId && job.url
      ? { kind: "youtube" as const, videoId: job.videoId, url: job.url }
      : undefined);
  return {
    ...job,
    id: jobIdentity(job),
    ...(source ? { source } : {}),
    summaryKind: kind,
    summary: typeof job.summary === "string" ? job.summary : "",
    timestampQuality: job.timestampQuality ?? (source?.kind === "youtube" ? "source" : "none"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateUploadSettings(value: unknown, code: "invalid_backup" | "invalid_history"): void {
  if (
    !isRecord(value) ||
    !["ko-en", "ko", "en", "auto"].includes(String(value.language)) ||
    !["speech", "meeting", "interview", "lecture", "podcast", "ai-conference", "lyrics"].includes(
      String(value.contentMode),
    ) ||
    !Array.isArray(value.keywords) ||
    value.keywords.some((keyword) => typeof keyword !== "string") ||
    (value.prompt !== undefined && typeof value.prompt !== "string")
  )
    invalid(
      "Upload processing settings are invalid. The saved history and settings were not changed.",
      code,
    );
}

/** Reject binary media and values that JSON would silently discard or corrupt. */
function assertJsonData(
  value: unknown,
  code: "invalid_backup" | "invalid_history",
  seen = new Set<object>(),
  depth = 0,
): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || depth > 100 || seen.has(value))
    invalid(
      "History must contain ordinary JSON data, without media files or circular references.",
      code,
    );
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    invalid("Backups and history cannot contain original media files or binary data.", code);
  seen.add(value);
  for (const child of Object.values(value)) assertJsonData(child, code, seen, depth + 1);
  seen.delete(value);
}

function validateJob(
  value: unknown,
  code: "invalid_backup" | "invalid_history" = "invalid_history",
): Job {
  if (!isRecord(value)) invalid("A transcript job is not an object.", code);
  assertJsonData(value, code);
  if (
    typeof value.title !== "string" ||
    typeof value.language !== "string" ||
    !["auto", "ko", "en"].includes(String(value.requestedLang)) ||
    !["manual", "asr", "transcription"].includes(String(value.sourceType)) ||
    typeof value.provider !== "string" ||
    typeof value.providerLabel !== "string" ||
    !finiteNonnegative(value.segmentCount) ||
    !finiteNonnegative(value.durationSec) ||
    !finiteNonnegative(value.createdAt) ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.paragraphs) ||
    !Array.isArray(value.availableLanguages)
  ) {
    invalid(
      "A transcript job is missing required metadata. The original history was not changed.",
      code,
    );
  }
  for (const segment of [...value.segments, ...value.paragraphs]) {
    if (
      !isRecord(segment) ||
      typeof segment.text !== "string" ||
      !finiteNonnegative(segment.start) ||
      !finiteNonnegative(segment.duration) ||
      (segment.speaker !== undefined && typeof segment.speaker !== "string")
    ) {
      invalid("A transcript contains invalid text or timestamps.", code);
    }
  }
  if (value.id !== undefined && (typeof value.id !== "string" || !value.id.trim()))
    invalid("A job ID must be a nonempty string.", code);
  if (value.videoId !== undefined && typeof value.videoId !== "string")
    invalid("A YouTube video ID must be text.", code);
  if (value.url !== undefined && typeof value.url !== "string")
    invalid("A source URL must be text.", code);
  if (value.source !== undefined) {
    if (!isRecord(value.source)) invalid("A job source is invalid.", code);
    if (value.source.kind === "youtube") {
      if (
        typeof value.source.videoId !== "string" ||
        !value.source.videoId ||
        typeof value.source.url !== "string"
      )
        invalid("A YouTube source is missing its video ID or URL.", code);
    } else if (value.source.kind === "upload") {
      if (
        typeof value.source.fileName !== "string" ||
        typeof value.source.mimeType !== "string" ||
        !finiteNonnegative(value.source.sizeBytes) ||
        (value.source.lastModified !== undefined &&
          !finiteNonnegative(value.source.lastModified)) ||
        (value.source.fingerprint !== undefined && typeof value.source.fingerprint !== "string")
      )
        invalid("An upload source is missing its file metadata.", code);
    } else invalid("A job source type is unsupported.", code);
  }
  if (
    !value.source &&
    !(typeof value.videoId === "string" && value.videoId && typeof value.url === "string")
  )
    invalid("A transcript job is missing its source metadata.", code);
  if (value.summary !== undefined && typeof value.summary !== "string")
    invalid("A summary must be text.", code);
  if (value.paragraphEdits !== undefined) {
    if (!isRecord(value.paragraphEdits))
      invalid("Manual paragraph edits must be a map of timestamps to text and speakers.", code);
    for (const [timestamp, edit] of Object.entries(value.paragraphEdits)) {
      const time = Number(timestamp);
      if (
        !finiteNonnegative(time) ||
        String(time) !== timestamp ||
        !isRecord(edit) ||
        typeof edit.text !== "string" ||
        (edit.speaker !== undefined && typeof edit.speaker !== "string") ||
        Object.keys(edit).some((key) => key !== "text" && key !== "speaker")
      ) {
        invalid("A manual paragraph edit has an invalid timestamp, text, or speaker.", code);
      }
    }
  }
  if (
    value.timestampQuality !== undefined &&
    !["source", "provider", "chunk-estimated", "none"].includes(String(value.timestampQuality))
  )
    invalid("Timestamp quality is invalid.", code);
  if (value.upload !== undefined) {
    if (
      !isRecord(value.upload) ||
      !isRecord(value.upload.settings) ||
      !Array.isArray(value.upload.chunks) ||
      !Array.isArray(value.upload.plan)
    )
      invalid("An upload checkpoint is invalid.", code);
    const statuses = [
      "idle",
      "inspecting",
      "preparing",
      "extracting-audio",
      "analyzing-boundaries",
      "chunking",
      "transcribing",
      "merging",
      "postprocessing",
      "completed",
      "cancelled",
      "failed",
    ];
    if (!statuses.includes(String(value.upload.status)))
      invalid("An upload job status is invalid.", code);
    validateUploadSettings(value.upload.settings, code);
    for (const chunk of [...value.upload.chunks, ...value.upload.plan]) {
      if (
        !isRecord(chunk) ||
        typeof chunk.id !== "string" ||
        !chunk.id ||
        !finiteNonnegative(chunk.index) ||
        !Number.isInteger(chunk.index) ||
        !finiteNonnegative(chunk.start) ||
        !finiteNonnegative(chunk.end) ||
        chunk.end < chunk.start ||
        !finiteNonnegative(chunk.coreStart) ||
        !finiteNonnegative(chunk.coreEnd) ||
        chunk.coreEnd < chunk.coreStart ||
        chunk.coreStart < chunk.start ||
        chunk.coreEnd > chunk.end
      )
        invalid("An upload chunk checkpoint is invalid.", code);
    }
    for (const chunk of value.upload.chunks) {
      if (
        !isRecord(chunk.transcript) ||
        typeof chunk.transcript.text !== "string" ||
        !["source", "provider", "chunk-estimated", "none"].includes(
          String(chunk.transcript.timestampQuality),
        ) ||
        !finiteNonnegative(chunk.completedAt) ||
        !finiteNonnegative(chunk.sizeBytes)
      )
        invalid("A completed upload chunk is missing its transcript or checkpoint metadata.", code);
    }
  }
  return normalizeJob(value as unknown as Job);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new StorageError(
        "storage_unavailable",
        "This browser does not support local transcript storage.",
      ),
    );
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("jobs"))
        database.createObjectStore("jobs", { keyPath: "id" });
      if (!database.objectStoreNames.contains("settings"))
        database.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(
        new StorageError(
          "storage_unavailable",
          "Another INTERTEXT tab is blocking the history upgrade. Close that tab and retry.",
        ),
      );
    };
  });
}

function transact<T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  action: (
    transaction: IDBTransaction,
    result: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let value: T;
    let actionError: unknown;
    let abortRequested = false;
    const transaction = database.transaction(stores, mode);
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(storageError(actionError ?? transaction.error));
    transaction.onerror = (event) => {
      const target = event.target as IDBRequest | null;
      actionError ??= target?.error ?? transaction.error;
    };
    const fail = (error: unknown) => {
      if (abortRequested) return;
      abortRequested = true;
      actionError ??= error;
      try {
        transaction.abort();
      } catch {
        reject(storageError(actionError));
      }
    };
    try {
      action(
        transaction,
        (next) => {
          value = next;
        },
        fail,
      );
    } catch (error) {
      fail(error);
    }
  });
}

function localStorageIfAvailable(): Storage | undefined {
  try {
    return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}

async function migrateLegacy(database: IDBDatabase): Promise<void> {
  const legacyStorage = localStorageIfAvailable();
  if (!legacyStorage) return;
  const snapshots = LEGACY_KEYS.flatMap((key) => {
    const raw = legacyStorage.getItem(key);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return invalid(
        `The legacy history in ${key} is not valid JSON. It was kept so it can be recovered.`,
      );
    }
    if (!Array.isArray(parsed))
      invalid(
        `The legacy history in ${key} is not a job list. It was kept so it can be recovered.`,
      );
    return [{ key, raw, jobs: parsed.map((job) => validateJob(job)) }];
  });
  if (!snapshots.length) return;
  // v2 wins over v1 for duplicate legacy records, but never overwrites an edited IndexedDB job.
  const deduped = new Map<string, Job>();
  for (const snapshot of snapshots)
    for (const job of snapshot.jobs) deduped.set(jobIdentity(job), job);
  await transact<void>(database, ["jobs", "settings"], "readwrite", (transaction, result, fail) => {
    const jobs = transaction.objectStore("jobs");
    const settings = transaction.objectStore("settings");
    for (const snapshot of snapshots) {
      const marker = `${INTERNAL_PREFIX}migrated:${snapshot.key}`;
      const receipt = settings.get(marker);
      receipt.onsuccess = () => {
        try {
          const saved = (receipt.result as SettingRecord | undefined)?.value;
          const previous =
            saved === true
              ? snapshot.jobs.map(jobIdentity)
              : isRecord(saved) && Array.isArray(saved.jobIds)
                ? saved.jobIds.filter((id): id is string => typeof id === "string")
                : [];
          const imported = new Set(previous);
          for (const job of snapshot.jobs) {
            const selected = deduped.get(jobIdentity(job))!;
            const id = jobIdentity(selected);
            // A committed receipt prevents deleted jobs from reappearing if localStorage cleanup failed.
            if (imported.has(id)) continue;
            imported.add(id);
            const existing = jobs.get(id);
            existing.onsuccess = () => {
              try {
                if (!existing.result) jobs.put(selected);
              } catch (error) {
                fail(error);
              }
            };
          }
          settings.put({ key: marker, value: { version: 1, jobIds: [...imported] } });
        } catch (error) {
          fail(error);
        }
      };
    }
    result(undefined);
  });
  // Only remove the exact snapshot that successfully committed. Newer legacy writes are kept.
  for (const snapshot of snapshots) {
    try {
      if (legacyStorage.getItem(snapshot.key) === snapshot.raw)
        legacyStorage.removeItem(snapshot.key);
    } catch {
      /* Committed receipts prevent duplicate imports if cleanup is blocked. */
    }
  }
}

async function withDatabase<T>(action: (database: IDBDatabase) => Promise<T>): Promise<T> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    await migrateLegacy(database);
    return await action(database);
  } catch (error) {
    throw storageError(error);
  } finally {
    database?.close();
  }
}

export async function loadJobs(): Promise<Job[]> {
  // Server rendering has no browser history; browser failures remain visible to the caller.
  if (typeof window === "undefined" && typeof indexedDB === "undefined") return [];
  return withDatabase((database) =>
    transact<Job[]>(database, ["jobs"], "readonly", (transaction, result, fail) => {
      const request = transaction.objectStore("jobs").getAll();
      request.onsuccess = () => {
        try {
          result(
            (request.result as unknown[])
              .map((job) => validateJob(job))
              .sort((a, b) => b.createdAt - a.createdAt),
          );
        } catch (error) {
          fail(error);
        }
      };
    }),
  );
}

export async function saveJob(job: Job): Promise<void> {
  const next = validateJob(job);
  await withDatabase((database) =>
    transact<void>(database, ["jobs"], "readwrite", (transaction, result) => {
      transaction.objectStore("jobs").put(next);
      result(undefined);
    }),
  );
}

/** Atomically upsert a list; never truncate or silently delete older history. */
export async function saveJobs(jobs: Job[]): Promise<void> {
  const next = jobs.map((job) => validateJob(job));
  await withDatabase((database) =>
    transact<void>(database, ["jobs"], "readwrite", (transaction, result) => {
      const store = transaction.objectStore("jobs");
      for (const job of next) store.put(job);
      result(undefined);
    }),
  );
}

export async function deleteJob(id: string): Promise<void> {
  await withDatabase((database) =>
    transact<void>(database, ["jobs"], "readwrite", (transaction, result) => {
      transaction.objectStore("jobs").delete(id);
      result(undefined);
    }),
  );
}

/** This only updates the in-memory list. Persistence errors cannot discard that list. */
export function upsertJob(jobs: Job[], job: Job): Job[] {
  const next = normalizeJob(job);
  return [next, ...jobs.filter((existing) => jobIdentity(existing) !== jobIdentity(next))];
}

function validateSettingKey(
  key: string,
  code: "invalid_backup" | "invalid_history" = "invalid_history",
): void {
  if (!key || key.startsWith(INTERNAL_PREFIX))
    invalid("A settings key is invalid or reserved.", code);
}

function validateSetting(
  key: string,
  value: unknown,
  code: "invalid_backup" | "invalid_history" = "invalid_history",
): void {
  validateSettingKey(key, code);
  assertJsonData(value, code);
  if (key === "upload") validateUploadSettings(value, code);
}

export async function getSettings<T>(key: string): Promise<T | undefined> {
  validateSettingKey(key);
  return withDatabase((database) =>
    transact<T | undefined>(database, ["settings"], "readonly", (transaction, result, fail) => {
      const request = transaction.objectStore("settings").get(key);
      request.onsuccess = () => {
        try {
          const record = request.result as SettingRecord | undefined;
          if (record) validateSetting(key, record.value);
          result(record?.value as T | undefined);
        } catch (error) {
          fail(error);
        }
      };
    }),
  );
}

export async function setSettings<T>(key: string, value: T): Promise<void> {
  validateSetting(key, value);
  await withDatabase((database) =>
    transact<void>(database, ["settings"], "readwrite", (transaction, result) => {
      transaction.objectStore("settings").put({ key, value });
      result(undefined);
    }),
  );
}

export async function exportBackup(): Promise<string> {
  const backup = await withDatabase((database) =>
    transact<IntertextBackup>(
      database,
      ["jobs", "settings"],
      "readonly",
      (transaction, result, fail) => {
        const jobsRequest = transaction.objectStore("jobs").getAll();
        const settingsRequest = transaction.objectStore("settings").getAll();
        let jobs: Job[] | undefined;
        let settings: Record<string, unknown> | undefined;
        const finish = () => {
          if (jobs && settings)
            result({
              format: "intertext-backup",
              version: 1,
              exportedAt: new Date().toISOString(),
              jobs,
              settings,
            });
        };
        jobsRequest.onsuccess = () => {
          try {
            jobs = (jobsRequest.result as unknown[]).map((job) => validateJob(job));
            finish();
          } catch (error) {
            fail(error);
          }
        };
        settingsRequest.onsuccess = () => {
          try {
            settings = Object.fromEntries(
              (settingsRequest.result as SettingRecord[])
                .filter((entry) => !entry.key.startsWith(INTERNAL_PREFIX))
                .map((entry) => [entry.key, entry.value]),
            );
            assertJsonData(settings, "invalid_history");
            for (const [key, value] of Object.entries(settings)) validateSetting(key, value);
            finish();
          } catch (error) {
            fail(error);
          }
        };
      },
    ),
  );
  return JSON.stringify(backup, null, 2);
}

export function validateBackup(input: string | unknown): IntertextBackup {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return invalid(
        "This backup is not valid JSON. Your history was not changed.",
        "invalid_backup",
      );
    }
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== "intertext-backup" ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.jobs) ||
    !isRecord(parsed.settings)
  )
    invalid(
      "This is not a supported INTERTEXT backup. Your history was not changed.",
      "invalid_backup",
    );
  assertJsonData(parsed, "invalid_backup");
  const jobs = parsed.jobs.map((job) => validateJob(job, "invalid_backup"));
  const identities = new Set<string>();
  for (const job of jobs) {
    const id = jobIdentity(job);
    if (identities.has(id))
      invalid(
        "The backup contains duplicate job IDs. Your history was not changed.",
        "invalid_backup",
      );
    identities.add(id);
  }
  for (const [key, value] of Object.entries(parsed.settings))
    validateSetting(key, value, "invalid_backup");
  return {
    format: "intertext-backup",
    version: 1,
    exportedAt:
      typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    jobs,
    settings: parsed.settings,
  };
}

/** Validate everything first, then merge jobs and settings in one all-or-nothing transaction. */
export async function importBackup(
  input: string | unknown,
): Promise<{ jobs: number; settings: number }> {
  const backup = validateBackup(input);
  await withDatabase((database) =>
    transact<void>(database, ["jobs", "settings"], "readwrite", (transaction, result) => {
      const jobs = transaction.objectStore("jobs");
      const settings = transaction.objectStore("settings");
      for (const job of backup.jobs) jobs.put(job);
      for (const [key, value] of Object.entries(backup.settings)) settings.put({ key, value });
      result(undefined);
    }),
  );
  return { jobs: backup.jobs.length, settings: Object.keys(backup.settings).length };
}

import type { Job, SummaryKind } from "./types";
import { isSummaryKind } from "./types";

const KEY = "intertext.jobs.v2";
const LIMIT = 10;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadJobs(): Job[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem("intertext.jobs.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isJob).slice(0, LIMIT);
  } catch {
    return [];
  }
}

function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<Job>;
  return (
    typeof v.videoId === "string" &&
    typeof v.url === "string" &&
    Array.isArray(v.segments) &&
    Array.isArray(v.paragraphs)
  );
}

function withJobDefaults(job: Job): Job {
  const kind: SummaryKind = isSummaryKind(String(job.summaryKind ?? ""))
    ? (job.summaryKind as SummaryKind)
    : "general";
  return {
    ...job,
    summaryKind: kind,
    summary: typeof job.summary === "string" ? job.summary : "",
  };
}

export function saveJobs(jobs: Job[]): Job[] {
  const next = jobs.map(withJobDefaults).slice(0, LIMIT);
  if (!canUseStorage()) return next;
  for (let n = next.length; n >= 0; n--) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next.slice(0, n)));
      return n === next.length ? next : next.slice(0, n);
    } catch {
      // QuotaExceeded — drop oldest by retrying with fewer jobs
    }
  }
  return next;
}

export function upsertJob(jobs: Job[], job: Job): Job[] {
  const rest = jobs.filter((j) => j.videoId !== job.videoId || j.language !== job.language);
  return saveJobs([withJobDefaults(job), ...rest]);
}

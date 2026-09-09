import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildJson, buildSrt, buildTxt, composeDocument, exportBasename, sanitizeFilename } from "./export.ts";
import type { Job } from "./types.ts";

const job: Job = {
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "인터뷰: 한글 제목 / slash",
  language: "ko",
  requestedLang: "ko",
  sourceType: "manual",
  provider: "youtube-transcript.ai",
  providerLabel: "youtube-transcript.ai",
  segmentCount: 2,
  durationSec: 8,
  createdAt: 0,
  segments: [
    { start: 0, duration: 4, text: "안녕하세요.", speaker: "진행자" },
    { start: 4, duration: 4, text: "반갑습니다.", speaker: "성상현" },
  ],
  paragraphs: [
    { start: 0, duration: 4, text: "안녕하세요.", speaker: "진행자" },
    { start: 4, duration: 4, text: "반갑습니다.", speaker: "성상현" },
  ],
  availableLanguages: [],
  summaryKind: "interview",
  summary: "- 진행자: 인사한다.\n- 성상현: 화답한다.",
  speakers: ["진행자", "성상현"],
};

describe("export", () => {
  it("uses the video title as the download basename", () => {
    const name = sanitizeFilename(job.title, job.videoId);
    assert.match(name, /한글/);
    assert.match(name, /인터뷰/);
    assert.doesNotMatch(name, /[<>:"/\\|?*]/);
    assert.equal(exportBasename(job), name);
    assert.equal(exportBasename(job).includes("_ko"), false);
  });

  it("writes valid SRT/JSON with speakers", () => {
    const srt = buildSrt(job);
    assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,000\n진행자: 안녕하세요\.\n/);
    const json = JSON.parse(buildJson(job)) as {
      language: string;
      title: string;
      summary: string;
      segments: Array<{ speaker?: string }>;
    };
    assert.equal(json.language, "ko");
    assert.equal(json.title, job.title);
    assert.match(json.summary, /인사/);
    assert.equal(json.segments.length, 2);
    assert.equal(json.segments[0]!.speaker, "진행자");
  });

  it("composes title, summary, then transcript", () => {
    const text = composeDocument(job, "off");
    const titleIdx = text.indexOf(job.title);
    const summaryIdx = text.indexOf("Summary");
    const bodyIdx = text.indexOf("진행자: 안녕하세요.");
    assert.equal(titleIdx, 0);
    assert.ok(summaryIdx > titleIdx);
    assert.ok(bodyIdx > summaryIdx);
    assert.match(text, /성상현: 반갑습니다/);
    const txt = buildTxt(job, "off");
    assert.equal(txt.startsWith(job.title), true);
  });
});

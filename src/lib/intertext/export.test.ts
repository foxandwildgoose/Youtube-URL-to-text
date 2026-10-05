import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCsv,
  buildJson,
  buildMarkdown,
  buildPrintHtml,
  buildSrt,
  buildTxt,
  buildVtt,
  composeDocument,
  exportBasename,
  renameSpeaker,
  sanitizeFilename,
  updateParagraph,
} from "./export.ts";
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
    const name = sanitizeFilename(job.title, job.videoId ?? "transcript");
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

  it("supports uploaded media without synthetic video IDs or URLs", () => {
    const upload = uploadedJob();
    assert.equal(exportBasename({ ...upload, title: "" }), "Meeting recording");
    assert.equal(exportBasename({ ...upload, title: "  " }), "Meeting recording");
    assert.equal(exportBasename({ ...upload, title: "", source: undefined }), "transcript");
    const markdown = buildMarkdown(upload, "off");
    assert.match(markdown, /Source: Meeting recording\.mp4/);
    assert.match(markdown, /Transcribed audio/);
    assert.doesNotMatch(markdown, /youtube\.com|undefined/);
    const json = JSON.parse(buildJson(upload));
    assert.equal(json.source.kind, "upload");
    assert.equal(json.timestampQuality, "chunk-estimated");
    assert.equal("videoId" in json, false);
    assert.equal("url" in json, false);
    assert.equal("upload" in json, false);
    assert.doesNotMatch(buildJson(upload), /raw provider checkpoint/);
  });

  it("honors optional timestamps, summary, and speaker content", () => {
    const options = { timestamps: false, speakers: false, summary: false };
    for (const text of [buildTxt(job, "inline", options), buildMarkdown(job, "inline", options)]) {
      assert.doesNotMatch(text, /\[0:00\]|Summary|진행자:|성상현:/);
      assert.match(text, /안녕하세요/);
    }
    assert.match(buildTxt(job, "off", { timestamps: true }), /\[0:00\]/);
    const json = JSON.parse(buildJson(job, options));
    assert.equal("summary" in json, false);
    assert.equal("summaryKind" in json, false);
    assert.equal(json.timestampQuality, "source");
    for (const value of [...json.segments, ...json.paragraphs]) {
      assert.equal("start" in value, false);
      assert.equal("duration" in value, false);
      assert.equal("speaker" in value, false);
    }
    assert.match(buildSrt(job, options), /00:00:00,000 --> 00:00:04,000\n안녕하세요/);
    assert.match(buildVtt(job, options), /00:00:00\.000 --> 00:00:04\.000\n안녕하세요/);
    assert.doesNotMatch(buildSrt(job, options), /진행자:/);
    assert.doesNotMatch(buildVtt(job, options), /진행자:/);
  });

  it("writes WebVTT timing and escapes cue markup as literal text", () => {
    const input = {
      ...job,
      segments: [{ start: 1.25, duration: 2.5, text: '<hello> & "world"', speaker: "Host" }],
    };
    assert.equal(
      buildVtt(input),
      'WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.750\nHost: &lt;hello&gt; &amp; "world"\n',
    );
    assert.equal(buildVtt({ ...job, segments: [] }), "WEBVTT\n\n");
  });

  it("quotes CSV commas, double quotes, and line breaks", () => {
    const input = {
      ...job,
      segments: [{ start: 1, duration: 2, text: 'Hello, "friend"\nNext line', speaker: 'A, "B"' }],
    };
    assert.equal(
      buildCsv(input, { summary: false }),
      '"type","start","end","speaker","text"\r\n"transcript","1","3","A, ""B""","Hello, ""friend""\nNext line"\r\n',
    );
    assert.equal(
      buildCsv(input, { timestamps: false, speakers: false, summary: false }),
      '"type","text"\r\n"transcript","Hello, ""friend""\nNext line"\r\n',
    );
    const withSummary = buildCsv({ ...input, summary: 'Summary, "quote"\nNext line' });
    assert.match(withSummary, /"summary","","","","Summary, ""quote""\nNext line"\r\n/);
    assert.equal(withSummary.match(/"summary"/g)?.length, 1);
  });

  it("escapes every dynamic field in the print document", () => {
    const upload = uploadedJob();
    assert.equal(upload.source?.kind, "upload");
    const malicious = '</title><script>alert("x")</script><img src=x onerror=alert(1)>';
    const input: Job = {
      ...upload,
      title: malicious,
      language: '" onload="alert(1)',
      providerLabel: malicious,
      summary: malicious,
      source: {
        kind: "upload",
        fileName: malicious,
        mimeType: "audio/wav",
        sizeBytes: 10,
        lastModified: 0,
        fingerprint: "fixture",
      },
      paragraphs: [{ start: 0, duration: 1, text: malicious, speaker: malicious }],
    };
    const html = buildPrintHtml(input, "inline");
    assert.doesNotMatch(html, /<script|<img|onload="alert/);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.match(html, /lang="&quot; onload=&quot;alert\(1\)"/);
    assert.match(html, /@media print/);
    assert.match(html, /\[0:00\]/);
    assert.match(html, /Timestamp quality: Chunk-estimated \(approximate\)/);
    const plain = buildPrintHtml(job, "inline", {
      timestamps: false,
      speakers: false,
      summary: false,
    });
    assert.doesNotMatch(plain, /<h2>Summary|<strong>|\[0:00\]/);
  });

  it("replaces edited paragraph cues in every export and preserves immutable raw checkpoints", () => {
    const original = uploadedJob();
    Object.freeze(original.upload!.chunks[0]!.transcript);
    Object.freeze(original.upload!.chunks[0]!);
    Object.freeze(original.upload!.chunks);
    const edited = updateParagraph(original, 0, { text: "Corrected wording.", speaker: "Editor" });
    assert.equal(edited.upload, original.upload);
    assert.equal(edited.upload!.chunks[0]!.transcript.text, "raw provider checkpoint");
    assert.equal(original.paragraphs[0]!.text, "old first old second");
    assert.equal(original.segments.length, 3);
    assert.deepEqual(edited.segments, [
      { start: 0, duration: 8, text: "Corrected wording.", speaker: "Editor" },
      original.segments[2],
    ]);
    assert.equal(edited.segmentCount, 2);
    assert.deepEqual(edited.paragraphEdits, {
      "0": { text: "Corrected wording.", speaker: "Editor" },
    });
    assert.equal(original.paragraphEdits, undefined);
    for (const output of [
      buildTxt(edited, "off"),
      buildMarkdown(edited, "off"),
      buildSrt(edited),
      buildVtt(edited),
      buildJson(edited),
      buildCsv(edited),
      buildPrintHtml(edited),
    ]) {
      assert.match(output, /Corrected wording/);
      assert.match(output, /next turn/);
      assert.doesNotMatch(output, /old first|old second|raw provider checkpoint/);
    }
  });

  it("assigns speaker edits by cue start even when earlier cue durations overlap", () => {
    const original = uploadedJob();
    const edited = updateParagraph(original, 0, { speaker: "New host" });
    assert.equal(edited.segments[0]!.speaker, "New host");
    assert.equal(edited.segments[1]!.speaker, "New host");
    assert.equal(edited.segments[2], original.segments[2]);
    assert.equal(edited.segments.length, original.segments.length);
    assert.equal(edited.upload, original.upload);
    const renamed = renameSpeaker(original, "Host", "Renamed");
    assert.deepEqual(
      renamed.segments.map((segment) => segment.speaker),
      ["Renamed", "Renamed", "Guest"],
    );
    assert.deepEqual(renamed.speakers, ["Renamed", "Guest"]);
    assert.equal(renamed.upload, original.upload);
    assert.deepEqual(renamed.paragraphEdits, {
      "0": { text: "old first old second", speaker: "Renamed" },
    });
  });

  it("removes emptied cues and supports restoring the paragraph later", () => {
    const original = uploadedJob();
    const cleared = updateParagraph(original, 0, { text: "  " });
    assert.deepEqual(cleared.segments, [original.segments[2]]);
    assert.deepEqual(cleared.paragraphEdits?.["0"], { text: "  ", speaker: "Host" });
    const restored = updateParagraph(cleared, 0, { text: "Restored." });
    assert.equal(restored.segments[0]!.text, "Restored.");
    assert.equal(restored.segments[1], original.segments[2]);
    assert.deepEqual(restored.paragraphEdits?.["0"], { text: "Restored.", speaker: "Host" });
    assert.equal(updateParagraph(original, -1, { text: "Invalid" }), original);
    assert.equal(updateParagraph(original, 0, { text: original.paragraphs[0]!.text }), original);
    assert.equal(updateParagraph(original, 0, { text: undefined }), original);
  });

  it("preserves other cues outside the edited paragraph span", () => {
    const input: Job = {
      ...job,
      paragraphs: [{ start: 0, duration: 2, text: "Paragraph." }],
      segments: [
        { start: 0, duration: 2, text: "Paragraph." },
        { start: 8, duration: 2, text: "Unrelated cue." },
      ],
    };
    const edited = updateParagraph(input, 0, { text: "Changed." });
    assert.equal(edited.segments[0]!.text, "Changed.");
    assert.equal(edited.segments[1], input.segments[1]);
  });

  it("records complete immutable paragraph overrides, including cleared speaker names", () => {
    const input = uploadedJob();
    const untouchedOverride = { text: "Other saved edit", speaker: "Other" };
    input.paragraphEdits = {
      "0": { text: "Earlier edit", speaker: "Host" },
      "25": untouchedOverride,
    };
    Object.freeze(input.paragraphEdits["0"]);
    Object.freeze(input.paragraphEdits);
    const cleared = updateParagraph(input, 0, { speaker: " " });
    assert.notEqual(cleared.paragraphEdits, input.paragraphEdits);
    assert.deepEqual(cleared.paragraphEdits?.["0"], {
      text: "old first old second",
      speaker: undefined,
    });
    assert.equal(Object.hasOwn(cleared.paragraphEdits!["0"]!, "speaker"), true);
    assert.equal(cleared.paragraphEdits?.["25"], untouchedOverride);
    assert.deepEqual(input.paragraphEdits["0"], { text: "Earlier edit", speaker: "Host" });
    assert.equal(cleared.upload, input.upload);

    const renamed = renameSpeaker(input, "Host", " ");
    assert.notEqual(renamed.paragraphEdits, input.paragraphEdits);
    assert.deepEqual(renamed.paragraphEdits?.["0"], {
      text: "old first old second",
      speaker: undefined,
    });
    assert.equal(renamed.paragraphEdits?.["25"], untouchedOverride);
    assert.equal(renamed.upload, input.upload);
    const saved = JSON.parse(JSON.stringify(cleared.paragraphEdits));
    const reapplied = updateParagraph(input, 0, {
      text: saved["0"].text,
      speaker: saved["0"].speaker,
    });
    assert.equal(reapplied.paragraphs[0]!.speaker, undefined);
    assert.equal(reapplied.segments[0]!.speaker, undefined);
    assert.doesNotMatch(buildJson(reapplied), /Earlier edit|Other saved edit/);
  });
});

function uploadedJob(): Job {
  return {
    ...job,
    id: "upload-fixture",
    videoId: undefined,
    url: undefined,
    title: "Uploaded meeting",
    sourceType: "transcription",
    provider: "openai",
    providerLabel: "OpenAI",
    source: {
      kind: "upload",
      fileName: "Meeting recording.mp4",
      mimeType: "video/mp4",
      sizeBytes: 100,
      lastModified: 0,
      fingerprint: "fixture",
    },
    timestampQuality: "chunk-estimated",
    summary: "Meeting summary.",
    segmentCount: 3,
    segments: [
      { start: 0, duration: 5, text: "old first", speaker: "Host" },
      { start: 2, duration: 8, text: "old second", speaker: "Host" },
      { start: 5, duration: 3, text: "next turn", speaker: "Guest" },
    ],
    paragraphs: [
      { start: 0, duration: 8, text: "old first old second", speaker: "Host" },
      { start: 5, duration: 3, text: "next turn", speaker: "Guest" },
    ],
    speakers: ["Host", "Guest"],
    upload: {
      status: "completed",
      settings: { language: "auto", contentMode: "meeting", keywords: [] },
      plan: [{ id: "chunk-1", index: 0, start: 0, end: 8, coreStart: 0, coreEnd: 8 }],
      chunks: [
        {
          id: "chunk-1",
          index: 0,
          start: 0,
          end: 8,
          coreStart: 0,
          coreEnd: 8,
          transcript: { text: "raw provider checkpoint", timestampQuality: "chunk-estimated" },
          completedAt: 0,
          sizeBytes: 100,
        },
      ],
    },
  };
}

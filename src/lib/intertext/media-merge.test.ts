import test from "node:test";
import assert from "node:assert/strict";
import { createChunkPlan } from "./media-chunks.ts";
import { matchChunkBoundary, mergeChunkTranscripts } from "./media-merge.ts";
import type { ChunkCheckpoint } from "./media-types.ts";

function pair(a: string, b: string): ChunkCheckpoint[] {
  return createChunkPlan(600).map((plan, index) => ({
    ...plan,
    transcript: { text: index ? b : a, timestampQuality: "chunk-estimated" },
    completedAt: 1,
    sizeBytes: 1,
  }));
}

test("known overlap removes exact Korean/English boundary sentence once", () => {
  const result = mergeChunkTranscripts(
    pair(
      "소개입니다. 오늘 Blackwell architecture를 설명하겠습니다.",
      "오늘 Blackwell architecture를 설명하겠습니다. 다음은 Rubin입니다.",
    ),
    "ai-conference",
  );
  assert.equal(result.text.match(/오늘 Blackwell/g)?.length, 1);
  assert.ok(result.text.includes("다음은 Rubin입니다."));
  assert.equal(result.audit[0]!.confidence, "high");
});

test("conservative bilingual fuzzy match keeps following technical content", () => {
  const source = pair(
    "NVIDIA Blackwell architecture에서는 HBM4가 중요합니다.",
    "엔비디아 Blackwell architecture에서는 HBM4가 중요합니다. 다음으로 NVLink를 보겠습니다.",
  );
  const raw = source[1]!.transcript.text;
  const result = mergeChunkTranscripts(source, "ai-conference");
  assert.ok(result.text.includes("NVIDIA Blackwell"));
  assert.ok(!result.text.includes("엔비디아 Blackwell"));
  assert.ok(result.text.includes("다음으로 NVLink를 보겠습니다."));
  assert.equal(source[1]!.transcript.text, raw);
  assert.equal(result.audit[0]!.matchMethod, "fuzzy-anchored");
});

test("Korean spacing variation can match without altering displayed speech", () => {
  const result = mergeChunkTranscripts(
    pair(
      "인공지능 기술의 성능이 오늘 크게 개선되었습니다.",
      "인공지능기술의 성능이 오늘 크게 개선되었습니다. 질문을 받겠습니다.",
    ),
    "speech",
  );
  assert.equal(result.text.match(/개선되었습니다/g)?.length, 1);
  assert.ok(result.text.includes("질문을 받겠습니다."));
});

test("character boundary matching handles many Korean spacing differences", () => {
  const result = mergeChunkTranscripts(
    pair(
      "오늘 인공 지능 기술 의 성능 이 크게 개선 되었습니다.",
      "오늘인공지능기술의성능이크게개선되었습니다. 다음 질문을 받겠습니다.",
    ),
    "speech",
  );
  assert.equal(result.text.match(/개선/g)?.length, 1);
  assert.ok(result.text.includes("다음 질문을 받겠습니다."));
});

test("long unspaced Korean candidates are bounded by the shared audio interval", () => {
  const repeated = "인공지능연구".repeat(10_000);
  const result = mergeChunkTranscripts(pair(repeated, `${repeated} 다음 내용`), "speech");
  assert.equal(result.audit[0]!.removedTextLength, 0);
  assert.ok(result.text.includes("다음 내용"));
});

test("ambiguous similar boundary keeps both and records uncertainty", () => {
  const source = pair(
    "The powerful Blackwell architecture improves performance today.",
    "The useful Blackwell architecture improves performance today. New content follows.",
  );
  const result = mergeChunkTranscripts(source, "speech");
  assert.ok(result.text.includes("powerful"));
  assert.ok(result.text.includes("useful"));
  assert.equal(result.audit[0]!.removedTextLength, 0);
});

test("short generic repetition and lyrics keep their legitimate repetition", () => {
  const short = mergeChunkTranscripts(pair("Thank you.", "Thank you. Next speaker."), "speech");
  assert.equal(short.text.match(/Thank you/g)?.length, 2);
  const lyrics = mergeChunkTranscripts(
    pair("The key point is inference cost.", "The key point is inference cost."),
    "lyrics",
  );
  assert.equal(lyrics.text.match(/inference cost/g)?.length, 2);
});

test("no global dedupe or removal outside a known adjacent audio overlap", () => {
  const source = pair(
    "The key point is inference cost. We discuss GPUs and memory today.",
    "Later in this talk: The key point is inference cost.",
  );
  assert.equal(
    mergeChunkTranscripts(source, "speech").text.match(/The key point is inference cost/g)?.length,
    2,
  );
  source[1]!.start = source[0]!.end;
  source[1]!.transcript.text = source[0]!.transcript.text;
  assert.equal(matchChunkBoundary(source[0]!, source[1]!, "speech").remove, 0);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTranscript,
  collapseRollingCaptions,
  decodeEntities,
  dedupeRepeatedPhrases,
  estimatedReadMinutes,
  mergeIntoSentences,
  pickTrack,
  visibleTranscript,
  wordCount,
} from "./clean.ts";
import {
  applySpeakerNames,
  labelInterviewByRole,
  peelSpeaker,
  speakersFromSummary,
} from "./speakers.ts";
import type { CaptionTrack, Segment } from "./types.ts";

describe("decodeEntities", () => {
  it("decodes named and numeric entities without mojibake", () => {
    const amp = "a \u0026amp; b";
    assert.equal(decodeEntities(amp), "a \u0026 b");
    assert.equal(decodeEntities("&#39;quote&#x22;"), "'quote\"");
    assert.equal(decodeEntities("한글&nbsp;유지"), "한글 유지");
  });
});

describe("caption cleaning", () => {
  it("collapses rolling-window ASR duplicates", () => {
    const raw: Segment[] = [
      { start: 0, duration: 1.2, text: "we are going to" },
      { start: 0.4, duration: 1.4, text: "we are going to talk about" },
      { start: 1.1, duration: 1.2, text: "talk about captions" },
    ];
    const out = collapseRollingCaptions(raw);
    assert.equal(out.length, 1);
    assert.match(out[0]!.text, /captions/);
    assert.doesNotMatch(out[0]!.text, /we are going to we are going to/);
  });

  it("merges chips into sentences and groups interview paragraphs", () => {
    const raw: Segment[] = [
      { start: 0, duration: 1.5, text: "Hello there," },
      { start: 1.6, duration: 1.4, text: "how are you today?" },
      { start: 4.2, duration: 2, text: "I wanted to ask about the work." },
      { start: 14, duration: 3, text: "Let us continue in a new block." },
    ];
    const cleaned = cleanTranscript(raw);
    assert.ok(cleaned.paragraphs.length >= 1);
    assert.ok(cleaned.paragraphs[0]!.text.includes("Hello there"));
    assert.equal(mergeIntoSentences(raw).length >= 2, true);
  });

  it("keeps Hangul wording intact", () => {
    const raw: Segment[] = [
      { start: 0, duration: 2, text: "안녕하세요." },
      { start: 2.2, duration: 2, text: "오늘 인터뷰 감사합니다." },
    ];
    const cleaned = cleanTranscript(raw);
    const text = cleaned.paragraphs.map((p) => p.text).join(" ");
    assert.match(text, /안녕하세요/);
    assert.match(text, /인터뷰/);
    assert.ok(wordCount(text) > 0);
    assert.ok(estimatedReadMinutes(text, "ko") >= 1);
  });

  it("strips >> markers without inventing A/B speakers", () => {
    const raw: Segment[] = [
      { start: 0, duration: 3, text: ">> Welcome to the show." },
      { start: 3.2, duration: 4, text: ">> Thanks for having me today." },
      { start: 8, duration: 5, text: ">> Let's start with your first book." },
    ];
    const cleaned = cleanTranscript(raw);
    for (const p of cleaned.paragraphs) {
      assert.doesNotMatch(p.text, />>/);
      assert.equal(p.speaker, undefined);
    }
    assert.match(cleaned.paragraphs.map((p) => p.text).join(" "), /Welcome/);
    assert.match(cleaned.paragraphs.map((p) => p.text).join(" "), /Thanks for having me/);
  });

  it("splits a single cue that contains >> in the middle", () => {
    const raw: Segment[] = [
      { start: 0, duration: 6, text: "Good evening everyone >> Thank you, glad to be here." },
    ];
    const cleaned = cleanTranscript(raw);
    assert.ok(cleaned.paragraphs.length >= 2);
    assert.match(cleaned.paragraphs[0]!.text, /Good evening/);
    assert.match(cleaned.paragraphs[1]!.text, /Thank you/);
  });

  it("starts a new paragraph after a pause", () => {
    const raw: Segment[] = [
      { start: 0, duration: 2, text: "That is the first thought." },
      { start: 6.5, duration: 2, text: "And after a rest, a new line." },
    ];
    const cleaned = cleanTranscript(raw);
    assert.ok(cleaned.paragraphs.length >= 2);
    assert.match(cleaned.paragraphs[0]!.text, /first thought/);
    assert.match(cleaned.paragraphs[1]!.text, /after a rest/);
  });

  it("lifts named speakers from caption prefixes", () => {
    const raw: Segment[] = [
      { start: 0, duration: 3, text: ">> Host: Welcome in." },
      { start: 3.5, duration: 3, text: ">> Guest: Happy to be here." },
    ];
    const cleaned = cleanTranscript(raw);
    assert.equal(cleaned.paragraphs[0]!.speaker, "Host");
    assert.equal(cleaned.paragraphs[1]!.speaker, "Guest");
    assert.equal(cleaned.paragraphs[0]!.text, "Welcome in.");
    assert.equal(cleaned.paragraphs[1]!.text, "Happy to be here.");
  });

  it("collapses Korean rolling ASR instead of alternating fake A/B lines", () => {
    const raw: Segment[] = [
      { start: 0, duration: 1.2, text: ">> 아" },
      { start: 0.4, duration: 1.2, text: ">> 아," },
      { start: 0.8, duration: 1.5, text: ">> 아" },
      { start: 1.5, duration: 2, text: ">> 아니면 그래서 앞으로 이제 유동성이" },
      { start: 2.5, duration: 2.2, text: ">> 아니면 그래서 앞으로 이제 유동성이" },
      {
        start: 3.5,
        duration: 3,
        text: ">> 아니면 그래서 앞으로 이제 유동성이 긴축되는 시장이냐? 긴축되는 시장이냐?",
      },
      { start: 7, duration: 1, text: ">> 네.이" },
      { start: 7.5, duration: 1, text: ">> 네.이" },
      { start: 8, duration: 1, text: ">> 네.이" },
      { start: 9, duration: 2, text: ">> 부분에 대한 장기 뷰가 어떻게" },
      { start: 10, duration: 2, text: ">> 부분에 대한 장기 뷰가 어떻게" },
    ];
    const cleaned = cleanTranscript(raw);
    const body = visibleTranscript(cleaned.paragraphs, "off");
    assert.doesNotMatch(body, /^A:/m);
    assert.doesNotMatch(body, /^B:/m);
    assert.doesNotMatch(body, /아니면 그래서 앞으로 이제 유동성이\n/);
    const liquidity = body.match(/아니면 그래서 앞으로 이제 유동성이/g) ?? [];
    assert.equal(liquidity.length, 1);
    const view = body.match(/부분에 대한 장기 뷰가 어떻게/g) ?? [];
    assert.equal(view.length, 1);
    assert.doesNotMatch(body, /긴축되는 시장이냐\? 긴축되는 시장이냐\?/);
    assert.match(body, /긴축되는 시장이냐/);
    assert.ok(cleaned.paragraphs.length <= 4);
  });
});

describe("dedupeRepeatedPhrases", () => {
  it("drops an immediately repeated Korean clause", () => {
    assert.equal(
      dedupeRepeatedPhrases("긴축되는 시장이냐? 긴축되는 시장이냐?"),
      "긴축되는 시장이냐?",
    );
  });

  it("collapses a word repeated three times", () => {
    assert.match(dedupeRepeatedPhrases("다룬다고 다룬다고 다룬다고 고정 댓글"), /^다룬다고 고정 댓글$/);
  });
});

describe("peelSpeaker", () => {
  it("reads >> and Name: prefixes", () => {
    assert.deepEqual(peelSpeaker(">> Hello there"), {
      speaker: undefined,
      text: "Hello there",
      turnMark: true,
    });
    assert.equal(peelSpeaker("A: Yes, go on.").speaker, "A");
    assert.equal(peelSpeaker("진행자: 안녕하세요.").speaker, "진행자");
  });
});

describe("speaker names", () => {
  it("reads 진행자 and guest names from summary bullets", () => {
    const names = speakersFromSummary(
      "- 진행자: 매크로·마이크로를 같이 보는 몇 안 되는 인물로 소개.\n- 성상현: 중기중앙회 약 10년 후 야생으로 나옴.",
    );
    assert.deepEqual(names, ["진행자", "성상현"]);
  });

  it("remaps A/B onto real names without adding lines", () => {
    const labeled = applySpeakerNames(
      [
        { start: 0, duration: 2, text: "소개하겠습니다.", speaker: "A" },
        { start: 3, duration: 2, text: "나와서 반갑습니다.", speaker: "B" },
      ],
      ["진행자", "성상현"],
    );
    assert.equal(labeled[0]!.speaker, "진행자");
    assert.equal(labeled[1]!.speaker, "성상현");
    assert.equal(labeled[0]!.text, "소개하겠습니다.");
    const body = visibleTranscript(labeled, "off");
    assert.match(body, /^진행자: /m);
    assert.match(body, /^성상현: /m);
    assert.doesNotMatch(body, /^A:/m);
  });

  it("applies named turns from the model without rewriting text", () => {
    const labeled = applySpeakerNames(
      [
        { start: 0, duration: 2, text: "질문이 있습니다." },
        { start: 3, duration: 4, text: "제 생각은 이렇습니다." },
      ],
      ["진행자", "성상현"],
      [
        { i: 0, speaker: "진행자" },
        { i: 1, speaker: "성상현" },
      ],
    );
    assert.equal(labeled[0]!.speaker, "진행자");
    assert.equal(labeled[1]!.speaker, "성상현");
    assert.equal(labeled[1]!.text, "제 생각은 이렇습니다.");
  });

  it("labels host questions and guest answers without adding lines", () => {
    const labeled = labelInterviewByRole(
      [
        { start: 0, duration: 2, text: "우리나라에서 매크로와 마이크로를 동시에 보시는 분 아닙니까?" },
        { start: 3, duration: 8, text: "중기중앙회에서 약 10년 일하다 야생으로 나왔습니다. 경력은 16년입니다." },
        { start: 12, duration: 2, text: "호칭은 본부장 가능합니까?" },
        { start: 15, duration: 6, text: "네 본부장이면 됩니다. 앞으로 뷰를 자유롭게 말하겠습니다." },
      ],
      ["진행자", "성상현"],
    );
    assert.equal(labeled[0]!.speaker, "진행자");
    assert.equal(labeled[1]!.speaker, "성상현");
    assert.equal(labeled[2]!.speaker, "진행자");
    assert.equal(labeled[3]!.speaker, "성상현");
    assert.equal(labeled.length, 4);
  });
});

describe("pickTrack", () => {
  const tracks: CaptionTrack[] = [
    { languageCode: "en", sourceType: "asr", isAutoGenerated: true },
    { languageCode: "ko", sourceType: "manual", isAutoGenerated: false },
    { languageCode: "ko", sourceType: "asr", isAutoGenerated: true },
    { languageCode: "ja", sourceType: "manual", isAutoGenerated: false },
  ];

  it("prefers Korean manual in auto, then requested language", () => {
    assert.equal(pickTrack(tracks, "auto")?.languageCode, "ko");
    assert.equal(pickTrack(tracks, "auto")?.sourceType, "manual");
    assert.equal(pickTrack(tracks, "en")?.languageCode, "en");
    assert.equal(pickTrack(tracks, "ko")?.sourceType, "manual");
  });
});

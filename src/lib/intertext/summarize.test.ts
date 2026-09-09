import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fallbackSummary, isTranscriptDump, parseSummaryPayload } from "./summarize.ts";

describe("fallbackSummary", () => {
  it("writes key points from opening, middle, and ending instead of pasting the intro", () => {
    const paragraphs = [
      { text: "2023년도 금리 올랐잖아요. 근데 자산 시간 왜 올랐습니까?" },
      { text: "우리는 이제 연준 하나만 보고 모든 유동성을 전망을 해 버리면 투자를 정반대로 한다." },
      { text: "고정 댓글을 참고하세요. 좋아요와 구독 부탁드립니다." },
      { text: "인플레이션을 헤지할 수 있는 자산을 들고 가야 되고 지금 투자 매력이 높아진 기업들이 많다." },
      { text: "다시 한번 반도체 섹터를 공부하면서 업데이트를 해야 되는 시기다." },
      { text: "핵심 변수가 주가의 90% 이상을 결정합니다. 장기 뷰는 유동성보다 실적이다." },
    ];
    const text = fallbackSummary("매크로 인터뷰", "interview", paragraphs);
    assert.doesNotMatch(text, /auto-extracted/i);
    assert.match(text, /^- /m);
    assert.match(text, /반도체|인플레이션|90%|유동성|실적/);
    const introIdx = text.indexOf("2023년도 금리");
    const later = /반도체|인플레이션|90%/.test(text);
    assert.equal(later, true);
    if (introIdx >= 0) {
      assert.ok(text.length - introIdx > 40 || later);
    }
  });
});

describe("isTranscriptDump", () => {
  it("flags pasted opening captions", () => {
    const paragraphs = [{ text: "2023년도 금리 올랐잖아요. 근데 자산 시간 왜 올랐습니까? 우리는 이제 연준 하나만 보고" }];
    assert.equal(
      isTranscriptDump(
        "Interview notes (auto-extracted):\n2023년도 금리 올랐잖아요. 근데 자산 시간 왜 올랐습니까?",
        paragraphs,
      ),
      true,
    );
    assert.equal(
      isTranscriptDump("- 진행자: 금리와 자산 가격의 괴리를 물었다.\n- 성상현: 연준만 보면 반대로 투자하게 된다고 했다.", paragraphs),
      false,
    );
  });
});

describe("parseSummaryPayload", () => {
  it("reads speakers from JSON", () => {
    const parsed = parseSummaryPayload(
      JSON.stringify({
        summary: "- 진행자: 소개.\n- 성상현: 경력.",
        speakers: ["진행자", "성상현"],
      }),
    );
    assert.match(parsed.summary, /성상현/);
    assert.deepEqual(parsed.speakers, ["진행자", "성상현"]);
  });

  it("falls back to bullet names when JSON speakers are missing", () => {
    const parsed = parseSummaryPayload("- 진행자: 질문.\n- 성상현: 답변.");
    assert.deepEqual(parsed.speakers, ["진행자", "성상현"]);
    assert.equal(parsed.turns.length, 0);
  });
});

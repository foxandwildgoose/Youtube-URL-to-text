import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeInput } from "./parse-url.ts";

function idOf(raw: string): string {
  const parsed = parseYouTubeInput(raw);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.message);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.video.videoId;
}

describe("parseYouTubeInput", () => {
  const id = "dQw4w9WgXcQ";

  it("accepts a raw 11-character id", () => {
    assert.equal(idOf(id), id);
  });

  it("parses watch URLs including extra query params", () => {
    assert.equal(
      idOf(`https://www.youtube.com/watch?v=${id}&t=90&list=PLxx&pp=ugE`),
      id,
    );
    assert.equal(idOf(`https://youtube.com/watch?app=desktop&v=${id}`), id);
    assert.equal(idOf(`http://m.youtube.com/watch?v=${id}`), id);
  });

  it("parses youtu.be, shorts, live, and embed", () => {
    assert.equal(idOf(`https://youtu.be/${id}?t=12`), id);
    assert.equal(idOf(`https://www.youtube.com/shorts/${id}`), id);
    assert.equal(idOf(`https://www.youtube.com/live/${id}?si=abc`), id);
    assert.equal(idOf(`https://www.youtube.com/embed/${id}?rel=0`), id);
    assert.equal(idOf(`https://www.youtube-nocookie.com/embed/${id}`), id);
  });

  it("strips noise after the id in a path", () => {
    assert.equal(idOf(`https://youtu.be/${id}&feature=share`), id);
  });

  it("rejects empty, non-YouTube, and malformed ids", () => {
    const empty = parseYouTubeInput("  ");
    assert.equal(empty.ok, false);

    const other = parseYouTubeInput("https://vimeo.com/123456");
    assert.equal(other.ok, false);

    const short = parseYouTubeInput("shortid");
    assert.equal(short.ok, false);

    const badV = parseYouTubeInput("https://www.youtube.com/watch?v=too-short");
    assert.equal(badV.ok, false);
  });

  it("rejects private-looking paths without a video id", () => {
    const parsed = parseYouTubeInput("https://www.youtube.com/channel/UCxxxxxx");
    assert.equal(parsed.ok, false);
  });
});

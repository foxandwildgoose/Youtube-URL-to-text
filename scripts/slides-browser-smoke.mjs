import assert from "node:assert/strict";
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slideConfiguration } from "../src/lib/intertext/slides/extraction.server.ts";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  base = process.env.SLIDES_SMOKE_URL ?? "http://127.0.0.1:8080";
const config = slideConfiguration({
  OPENAI_API_KEY: "mock-only",
  SLIDES_ACCESS_TOKEN: "mock-personal-slide-access-code",
});
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage(),
    errors = [],
    forbidden = [],
    payloads = [];
  let calls = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/api\/transcription|\/v1\/audio\/|api\.x\.ai/.test(r.url())) forbidden.push(r.url());
  });
  await page.route("https://fonts.googleapis.com/**", (r) =>
    r.fulfill({ contentType: "text/css", body: "" }),
  );
  await page.route("https://grok.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.route("**/api/slides-config", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(config) }),
  );
  await page.route("**/api/slides", async (r) => {
    calls++;
    const raw = r.request().postDataBuffer();
    assert(raw && raw.length < 3_500_000);
    payloads.push(raw.length);
    const contentType = r.request().headers()["content-type"];
    const form = await new Response(raw, { headers: { "content-type": contentType } }).formData(),
      image = form.get("image");
    assert(image instanceof Blob && image.type === "image/png");
    const textless = calls === 6;
    await r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        model: "gpt-6.1-sol",
        requestId: `mock-${calls}`,
        usage: {
          inputTokens: 3000,
          outputTokens: 1000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 100,
        },
        extraction: {
          status: textless ? "textless" : "text",
          blocks: textless
            ? []
            : [
                { type: "heading", text: "AI 보안 & Robotics", rows: [] },
                { type: "code", text: 'if x < 4:\n    print("HBM4")', rows: [] },
                { type: "footer", text: "작은 각주: https://example.test/slide?x=1&y=2", rows: [] },
              ],
          flags: [],
          unreadable: [],
        },
      }),
    });
  });
  await page.goto(base);
  await page.getByRole("tab", { name: "YouTube URL", exact: true }).waitFor();
  await page.waitForFunction(() =>
    Object.keys(document.getElementById("source-youtube") ?? {}).some((k) =>
      k.startsWith("__reactProps"),
    ),
  );
  await page.getByRole("tab", { name: "YouTube URL", exact: true }).focus();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.getElementById("source-slides")?.getAttribute("aria-selected") === "true",
  );
  await page
    .getByLabel("Select slide MP4")
    .setInputFiles(join(root, "tests/fixtures/slides-presentation.mp4"));
  await page.getByLabel("Local slide video preview").waitFor();
  await page
    .getByRole("button", { name: "Scan slide candidates locally", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Select slide MP4"]').disabled,
    { timeout: 20000 },
  );
  await page.getByLabel("Top left x percent").fill("4");
  await page
    .getByRole("button", { name: "Capture preview at playback position", exact: true })
    .click();
  await page.getByAltText("Perspective-corrected slide region").waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Select slide MP4"]').disabled,
  );
  await page.getByRole("button", { name: /Apply ROI keyframe at/ }).click();
  await page.getByLabel("Top left x percent").evaluate((input) => {
    if (input.value !== "4") throw Error("ROI did not retain manual correction");
  });
  assert.equal(calls, 0);
  await page.getByRole("button", { name: "Scan slide candidates locally", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Chronological slide candidates"]') &&
      !document.querySelector('[aria-label="Select slide MP4"]').disabled,
    { timeout: 120000 },
  );
  const snapshot = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("intertext");
        r.onsuccess = () => {
          const t = r.result.transaction("jobs"),
            q = t.objectStore("jobs").getAll();
          q.onsuccess = () => {
            resolve(q.result.find((j) => j.processingMode === "slides"));
            r.result.close();
          };
        };
        r.onerror = () => reject(r.error);
      }),
  );
  assert(snapshot.slides.scanComplete, snapshot.slides.error);
  assert(snapshot.slides.states.length >= 5);
  assert(snapshot.slides.audit.some((a) => a.kind === "black"));
  assert.equal(calls, 0);
  assert.deepEqual(forbidden, []);
  console.log(
    `No-audio native video → ${snapshot.slides.states.length} local states, black audit, zero paid/audio calls: passed`,
  );
  await page.getByLabel("Personal slide access code").fill("mock-personal-slide-access-code");
  await page
    .getByRole("checkbox", {
      name: "I approve paid extraction of the selected states at the displayed profile and estimate.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Extract approved slide text", exact: true })
    .evaluate((b) => {
      b.click();
      b.click();
    });
  await page.waitForFunction(
    () =>
      /known usage \$0\.(?!0000)\d+/.test(document.body.innerText) &&
      !document.querySelector('[aria-label="Select slide MP4"]').disabled,
    { timeout: 30000 },
  );
  await page
    .getByLabel(/^Edit slide block /)
    .first()
    .fill("수정한 AI 보안 제목");
  await page.waitForTimeout(200);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export slides TXT", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const exported = await readFile(path, "utf8");
  assert(exported.includes("수정한 AI 보안 제목"));
  assert(exported.includes('    print("HBM4")'));
  const paidBefore = calls;
  await page.reload();
  await page
    .getByRole("button", { name: /slides-presentation.mp4/ })
    .first()
    .click();
  await page
    .getByLabel(/^Edit slide block /)
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByLabel(/^Edit slide block /)
      .first()
      .inputValue(),
    "수정한 AI 보안 제목",
  );
  assert.equal(calls, paidBefore);
  await page
    .getByLabel("Select slide MP4")
    .setInputFiles(join(root, "tests/fixtures/slides-presentation.mp4"));
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Select slide MP4"]').disabled,
  );
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("intertext");
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("slideAssets", "readwrite");
          transaction.objectStore("slideAssets").clear();
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page
    .getByRole("button", {
      name: "Regenerate missing saved evidence · no model calls",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Select slide MP4"]').disabled,
    { timeout: 60000 },
  );
  assert.equal(calls, paidBefore);
  assert.equal(
    await page
      .getByLabel(/^Edit slide block /)
      .first()
      .inputValue(),
    "수정한 AI 보안 제목",
  );
  const assetsAfter = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("intertext");
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("slideAssets");
          const count = transaction.objectStore("slideAssets").count();
          count.onsuccess = () => {
            resolve(count.result);
            database.close();
          };
          count.onerror = () => reject(count.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  assert(assetsAfter >= snapshot.slides.states.length * 2, "Missing evidence was not recovered");
  assert(!(await page.getByText(/Regenerated pixels\/crops differ/).count()));
  console.log(
    "Original re-selection → evicted images regenerated locally, edited text retained, zero extra provider calls: passed",
  );
  await page.screenshot({ path: "/workspace/screenshots/slides-desktop.png", fullPage: true });
  await page
    .getByRole("region", { name: "Slide text review", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/workspace/screenshots/slides-review-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "/workspace/screenshots/slides-mobile.png", fullPage: true });
  await page.screenshot({
    path: "/workspace/screenshots/slides-review-mobile.png",
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(
    JSON.stringify({
      flow: "local video → images → measured mocked requests → checkpoints → edit/export/reload → image recovery",
      providerCalls: calls,
      maxPayloadBytes: Math.max(...payloads),
      audioCalls: 0,
      pageErrors: errors,
      mobileOverflow: false,
      recognition: "NOT EVALUATED",
      largeFile: "NOT RUN",
    }),
  );
} finally {
  await browser.close();
}

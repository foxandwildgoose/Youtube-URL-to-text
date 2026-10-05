import assert from "node:assert/strict";
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseUrl = process.env.MEDIA_SMOKE_URL ?? "http://127.0.0.1:8080";
const browserPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({
  ...(browserPath ? { executablePath: browserPath } : {}),
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Fonts/platform branding cannot be reached under current egress policy.
  // Remove only external-resource noise; application/API/worker requests remain real.
  await page.route("https://fonts.googleapis.com/**", (r) =>
    r.fulfill({ contentType: "text/css", body: "" }),
  );
  await page.route("https://grok.com/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.route("**/api/transcription-config", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        configured: false,
        model: "gpt-transcribe",
        message:
          "File transcription is unavailable because OPENAI_API_KEY is not configured on the server.",
      }),
    }),
  );
  let requests = 0;
  await page.route("**/api/transcription", async (r) => {
    requests++;
    const bytes = r.request().postDataBuffer();
    assert(bytes && bytes.length < 3_500_000);
    assert.match(r.request().headers()["content-type"], /multipart/);
    await r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        transcript: {
          text: "NVIDIA Blackwell architecture에서는 HBM4가 중요합니다. 다음으로 NVLink를 보겠습니다.",
          language: "ko,en",
          timestampQuality: "chunk-estimated",
        },
      }),
    });
  });
  await page.goto(baseUrl);
  await page.waitForTimeout(1000);
  await page.getByRole("tab", { name: "Upload File", exact: true }).click();
  await page
    .getByLabel("Select media file")
    .setInputFiles(join(root, "tests/fixtures/local-media.mp4"));
  await page.getByText("local-media.mp4", { exact: true }).waitFor();
  await page.getByLabel("Selected local video").waitFor();
  assert.match(await page.getByLabel("Selected local video").getAttribute("src"), /^blob:/);
  await page.getByRole("button", { name: "Start transcription", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "OPENAI_API_KEY" }).waitFor();
  console.log("Missing key guidance, file metadata, and local playback: passed");
  await page.screenshot({
    path: join("/workspace/screenshots", "upload-missing-key.png"),
    fullPage: true,
  });
  await page.unroute("**/api/transcription-config");
  await page.route("**/api/transcription-config", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        model: "gpt-transcribe",
        requiresAccessToken: true,
      }),
    }),
  );
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Personal access code").fill("browser-test-personal-access-code");
  await page
    .getByRole("button", { name: "Start transcription", exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page.getByRole("region", { name: "Transcript result" }).waitFor({ timeout: 120000 });
  assert.equal(requests, 1);
  assert.equal(
    await page.getByRole("button", { name: "Transcription complete", exact: true }).isDisabled(),
    true,
  );
  assert.match(await page.locator("body").innerText(), /HBM4/);
  console.log(
    "Real worker audio extraction → safe request → mocked transcription → IndexedDB → result: passed",
  );
  await page.screenshot({
    path: join("/workspace/screenshots", "upload-completed.png"),
    fullPage: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join("/workspace/screenshots", "upload-completed-mobile.png"),
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log("Mobile overflow and page errors: passed");
} finally {
  await browser.close();
}

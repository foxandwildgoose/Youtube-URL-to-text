// Reproducible transport/detection fixture, NOT a recognition evaluation.
import { chromium } from "playwright";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  temp = await mkdtemp(join(tmpdir(), "intertext-slides-fixture-"));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const states = [
  { name: "A", duration: 3, count: 4, bullet: "Mixed Korean + English" },
  { name: "number-change", duration: 3, count: 5, bullet: "Mixed Korean + English" },
  {
    name: "build",
    duration: 2,
    count: 5,
    bullet: "Mixed Korean + English\nIncremental bullet: NVLink",
  },
  { name: "replacement", duration: 2, count: 5, bullet: "Replaced text: HBM4 2.5 TB/s" },
  { name: "A-revisited", duration: 3, count: 4, bullet: "Mixed Korean + English" },
  { name: "textless", duration: 2 },
  { name: "black", duration: 1 },
];
try {
  const page = await browser.newPage();
  await page.setContent('<canvas width="1280" height="720"></canvas>');
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    const png = await page.evaluate((s) => {
      const c = document.querySelector("canvas"),
        ctx = c.getContext("2d");
      ctx.fillStyle = s.name === "black" ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, 1280, 720);
      if (s.name === "textless") {
        ctx.strokeStyle = "#30557c";
        ctx.lineWidth = 8;
        ctx.strokeRect(150, 150, 300, 250);
        ctx.strokeRect(750, 350, 300, 200);
        ctx.beginPath();
        ctx.moveTo(450, 275);
        ctx.lineTo(750, 450);
        ctx.stroke();
      } else if (s.name !== "black") {
        ctx.fillStyle = "#18263b";
        ctx.font = 'bold 44px "Noto Sans CJK KR", sans-serif';
        ctx.fillText("AI 보안 & Robotics", 70, 90);
        ctx.font = '28px "Noto Sans CJK KR", sans-serif';
        s.bullet.split("\n").forEach((line, n) => ctx.fillText(line, 70, 155 + n * 42));
        ctx.strokeStyle = "#18263b";
        ctx.lineWidth = 2;
        ctx.strokeRect(70, 260, 550, 170);
        ctx.beginPath();
        ctx.moveTo(70, 315);
        ctx.lineTo(620, 315);
        ctx.moveTo(70, 375);
        ctx.lineTo(620, 375);
        ctx.moveTo(350, 260);
        ctx.lineTo(350, 430);
        ctx.stroke();
        ctx.fillText("GPU", 90, 300);
        ctx.fillText("수량 / Count", 370, 300);
        ctx.fillText("Blackwell", 90, 360);
        ctx.fillText(String(s.count), 370, 360);
        ctx.fillText("Rubin", 90, 415);
        ctx.font = "24px monospace";
        ctx.fillText("if x < 4:", 700, 290);
        ctx.fillText('    print("HBM4")', 700, 330);
        ctx.fillText("E = mc² · 2.5 TB/s", 700, 395);
        ctx.font = '14px "Noto Sans CJK KR", sans-serif';
        ctx.fillText(
          "작은 각주: https://example.test/slide?x=1&y=2 · visible typo: securtiy",
          70,
          680,
        );
      }
      return c.toDataURL("image/png").split(",")[1];
    }, state);
    await writeFile(join(temp, `${i}.png`), Buffer.from(png, "base64"));
  }
  const list =
    states.map((s, i) => `file '${join(temp, `${i}.png`)}'\nduration ${s.duration}`).join("\n") +
    `\nfile '${join(temp, `${states.length - 1}.png`)}'\n`;
  await writeFile(join(temp, "frames.txt"), list);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(temp, "frames.txt"),
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "20",
    "-t",
    String(states.reduce((n, s) => n + s.duration, 0)),
    "-movflags",
    "+faststart",
    join(root, "tests/fixtures/slides-presentation.mp4"),
  ]);
  await writeFile(
    join(root, "tests/fixtures/slides-presentation.json"),
    JSON.stringify(
      {
        kind: "generated presentation fixture, no audio",
        width: 1280,
        height: 720,
        expectedStates: states.map((s, i) => ({
          ...s,
          start: states.slice(0, i).reduce((n, x) => n + x.duration, 0),
        })),
        recognition: "NOT EVALUATED: ordinary tests mock the provider",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Created no-audio slide fixture with known states; recognition is not evaluated.");
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}

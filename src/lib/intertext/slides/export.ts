import type { Job } from "../types.ts";
import type { DisplayState, TextBlock } from "./types.ts";
export function formatSlideTime(seconds: number): string {
  const millis = Math.round(Math.max(0, seconds) * 1000),
    hours = Math.floor(millis / 3_600_000),
    minutes = Math.floor(millis / 60_000) % 60,
    secs = Math.floor(millis / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`;
}
export function stateBlocks(
  state: DisplayState,
): { key: string; block: TextBlock; edited?: string; cropId: string }[] {
  const evidence = state.evidence.find((e) => e.id === state.representativeId);
  if (!evidence) return [];
  return evidence.crops.flatMap((crop) => {
    const complete = state.attempts.filter(
      (a) => a.cropId === crop.id && a.outcome === "completed" && a.extraction,
    );
    const accepted = state.acceptedAttemptIds?.[crop.id];
    const attempt =
      (accepted ? complete.find((a) => a.id === accepted) : undefined) ?? complete.at(-1);
    return (attempt?.extraction?.blocks ?? []).map((block, index) => ({
      key: `${crop.id}:${index}`,
      block,
      edited: state.edits[`${crop.id}:${index}`],
      cropId: crop.id,
    }));
  });
}
export function literalBlock(block: TextBlock): string {
  return block.type === "table" ? block.rows.map((row) => row.join("\t")).join("\n") : block.text;
}
function markdownEscape(text: string): string {
  return text.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&");
}
function markdownBlock(block: TextBlock, edited?: string): string {
  const text = edited ?? literalBlock(block);
  if (edited === undefined && block.type === "table") {
    const rows = block.rows.map(
      (row) => `| ${row.map((cell) => markdownEscape(cell).replace(/\n/g, "<br>")).join(" | ")} |`,
    );
    if (rows.length) rows.splice(1, 0, `| ${block.rows[0]!.map(() => "---").join(" | ")} |`);
    return rows.join("\n");
  }
  if (block.type === "code") {
    const fences = text.match(/`+/g) ?? [];
    const fence = "`".repeat(Math.max(3, ...fences.map((s) => s.length + 1)));
    return `${fence}\n${text}\n${fence}`;
  }
  return markdownEscape(text);
}
export function exportSlides(job: Job, format: "txt" | "md" | "json"): string {
  if (job.processingMode !== "slides" || !job.slides)
    throw new Error("This is not a visual text job.");
  if (format === "json")
    return JSON.stringify(
      {
        format: "intertext-slides",
        version: 1,
        title: job.title,
        source: job.source,
        durationSec: job.durationSec,
        timingNote:
          "Half-open display intervals; millisecond formatting is not millisecond accuracy.",
        evidenceNote:
          "Images and original video are excluded. Re-select the source to regenerate evidence.",
        slides: job.slides,
      },
      null,
      2,
    );
  return job.slides.states
    .filter((s) => s.status !== "excluded")
    .map((state, i) => {
      const blocks = stateBlocks(state),
        heading = blocks.find((b) => b.block.type === "heading"),
        title = heading
          ? (heading.edited ?? heading.block.text)
          : "[Non-source label: titleless slide]";
      const label = `[${formatSlideTime(state.start)} – ${formatSlideTime(state.end)}] Slide ${String(i + 1).padStart(3, "0")} — ${title}`;
      const source = blocks
        .map((b) =>
          format === "md" ? markdownBlock(b.block, b.edited) : (b.edited ?? literalBlock(b.block)),
        )
        .join("\n\n");
      const evidence = state.evidence.find((e) => e.id === state.representativeId);
      const crops = evidence?.crops ?? [];
      const extractions = crops.map((crop) => {
        const complete = state.attempts.filter(
          (a) => a.cropId === crop.id && a.outcome === "completed" && a.extraction,
        );
        const accepted = state.acceptedAttemptIds?.[crop.id];
        return ((accepted ? complete.find((a) => a.id === accepted) : undefined) ?? complete.at(-1))
          ?.extraction;
      });
      const status =
        extractions.length > 0 && extractions.every((e) => e?.status === "textless")
          ? "[Audit: textless source region]"
          : !blocks.length
            ? "[Audit: extraction pending/incomplete]"
            : "";
      return `${format === "md" ? "### " : ""}${format === "md" ? markdownEscape(label) : label}\n${source}${status ? `\n${status}` : ""}`;
    })
    .join("\n\n");
}

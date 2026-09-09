import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
import { s as speakersFromSummary } from "./speakers-B7cJ0sRR.mjs";
import { n as isSummaryKind } from "./types-CBU5YDVN.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/summarize-vRenAmlE.js
var KIND_INSTRUCTIONS = {
	general: "Write an overview of the whole talk: what it is, the main points in order (including the middle and the ending), and the conclusion.",
	meeting: "Write meeting notes for the whole session: topics, decisions, action items, and open questions.",
	course: "Write study notes for the whole lesson: objectives, concepts in order, definitions, and takeaways.",
	interview: "Write interview notes for the whole conversation: who is speaking, the through-line, notable questions and answers, positions, and the closing view. Name people with real names (Korean host: 진행자 if unnamed; English: Host if unnamed).",
	podcast: "Write episode notes for the whole episode: hosts/guests, segments in order, highlights, and closing mentions."
};
var MODEL = "grok-4.5";
var DIRECT_CHARS = 11e3;
var CHUNK_CHARS = 7e3;
var MAX_CHUNKS = 5;
var MAX_PROMPT_CHARS = 4e4;
function clipAtBoundary(text, max) {
	if (text.length <= max) return text;
	const slice = text.slice(0, max);
	const sentence = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"), slice.lastIndexOf("\n"));
	if (sentence > max * .55) return slice.slice(0, sentence + 1).trim();
	const space = slice.lastIndexOf(" ");
	return (space > 0 ? slice.slice(0, space) : slice).trim();
}
function stripNoise(text) {
	return text.replace(/\s*[\[(](?:음악|웃음|박수|intro|music|laughter|applause)[\])]\s*/gi, " ").replace(/\s+/g, " ").trim();
}
function splitSentences(text) {
	const cleaned = stripNoise(text);
	if (!cleaned) return [];
	return cleaned.split(/(?<=[.!?…。？！])\s+|(?<=(?:니다|까요|세요|죠))\s+/).map((s) => s.trim()).filter((s) => s.length >= 10);
}
function isBoilerplate(sentence) {
	return /구독|좋아요|고정\s*댓글|참고하세요|알람|알림\s*설정|intro music|thanks for watching/i.test(sentence);
}
function scoreSentence(sentence, index, total) {
	let score = 0;
	const pos = total <= 1 ? .5 : index / (total - 1);
	if (pos <= .12 || pos >= .72) score += 1.4;
	else score += 1;
	if (/[?？]|까요|나요|습니까|입니까/.test(sentence)) score += 1.6;
	if (/\d/.test(sentence)) score += 1.3;
	if (sentence.length >= 22 && sentence.length <= 140) score += 1;
	if (sentence.length > 220) score -= .8;
	if (isBoilerplate(sentence)) score -= 3;
	return score;
}
function shortenPoint(sentence, max = 110) {
	return clipAtBoundary(stripNoise(sentence).replace(/^[-*•]\s*/, ""), max);
}
/**
* Key points drawn from the opening, middle, and ending — never a pasted intro.
*/
function fallbackSummary(title, kind, paragraphs) {
	const sentences = paragraphs.flatMap((p) => splitSentences(p.text));
	const usable = sentences.filter((s) => !isBoilerplate(s));
	const pool = usable.length > 0 ? usable : sentences;
	if (pool.length === 0) return `No usable caption text to summarize for “${title || "this video"}”.`;
	const scored = pool.map((s, i) => ({
		s,
		i,
		score: scoreSentence(s, i, pool.length)
	}));
	const thirds = [];
	for (let t = 0; t < 3; t++) {
		const a = Math.floor(pool.length * t / 3);
		const b = Math.max(a + 1, Math.floor(pool.length * (t + 1) / 3));
		const slice = scored.slice(a, b).sort((x, y) => y.score - x.score);
		const take = Math.min(3, Math.max(1, slice.length));
		for (const item of slice.slice(0, take)) {
			const point = shortenPoint(item.s);
			if (point && !thirds.some((line) => line.includes(point.slice(0, 24)))) thirds.push(point);
		}
	}
	const bullets = thirds.slice(0, 10).map((line) => `- ${line}`);
	if (bullets.length === 0) return `- ${shortenPoint(pool[0], 120)}`;
	return [`${kind === "meeting" ? "Meeting" : kind === "course" ? "Course" : kind === "interview" ? "Interview" : kind === "podcast" ? "Episode" : "Talk"} key points:`, ...bullets].join("\n");
}
function isTranscriptDump(summary, paragraphs) {
	const text = summary.trim();
	if (!text) return true;
	if (/auto-extracted/i.test(text)) return true;
	const opening = paragraphs.slice(0, 6).map((p) => p.text).join(" ").replace(/\s+/g, " ");
	const compact = text.replace(/^[-*•]\s*/gm, "").replace(/\s+/g, " ").trim();
	if (compact.length >= 80 && opening.includes(compact.slice(0, 72))) return true;
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
	if (lines.filter((l) => l.length > 180).length >= 2 && lines.length <= 4) return true;
	return false;
}
function transcriptBody(paragraphs, max = MAX_PROMPT_CHARS) {
	const lines = [];
	let used = 0;
	for (const p of paragraphs) {
		const line = `${p.speaker ? `${p.speaker}: ` : ""}${p.text}`;
		if (used + line.length + 1 > max) break;
		lines.push(line);
		used += line.length + 1;
	}
	return lines.join("\n");
}
function chunkTranscript(paragraphs) {
	const chunks = [];
	let buf = [];
	let n = 0;
	for (const p of paragraphs) {
		const line = `${p.speaker ? `${p.speaker}: ` : ""}${p.text}`;
		if (n + line.length > CHUNK_CHARS && buf.length > 0) {
			chunks.push(buf.join("\n"));
			buf = [];
			n = 0;
		}
		buf.push(line);
		n += line.length + 1;
	}
	if (buf.length) chunks.push(buf.join("\n"));
	if (chunks.length <= MAX_CHUNKS) return chunks;
	const kept = [chunks[0]];
	const mid = chunks.slice(1, -1);
	const need = 3;
	for (let i = 0; i < need; i++) {
		const idx = Math.round((i + 1) * mid.length / 4 - 1);
		const hit = mid[Math.max(0, Math.min(mid.length - 1, idx))];
		if (hit && !kept.includes(hit)) kept.push(hit);
	}
	const last = chunks[chunks.length - 1];
	if (last && kept[kept.length - 1] !== last) kept.push(last);
	return kept;
}
function languageHint(language, sample) {
	const hangul = (sample.match(/[\uAC00-\uD7A3]/g)?.length ?? 0) > 20;
	if (language.toLowerCase().startsWith("ko") || hangul) return "Write the entire summary in Korean.";
	if (language.toLowerCase().startsWith("en")) return "Write the entire summary in English.";
	return "Write the summary in the same language as the transcript.";
}
function isKorean(language, sample) {
	return languageHint(language, sample).includes("Korean");
}
function parseSummaryPayload(raw) {
	const candidate = (raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw).trim();
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start >= 0 && end > start) try {
		const obj = JSON.parse(candidate.slice(start, end + 1));
		const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
		const speakers = Array.isArray(obj.speakers) ? obj.speakers.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : [];
		const turns = Array.isArray(obj.turns) ? obj.turns.flatMap((t) => {
			if (!t || typeof t !== "object") return [];
			const rec = t;
			const i = typeof rec.i === "number" ? rec.i : Number(rec.i);
			const speaker = typeof rec.speaker === "string" ? rec.speaker.trim() : "";
			if (!Number.isInteger(i) || i < 0 || !speaker) return [];
			return [{
				i,
				speaker
			}];
		}) : [];
		if (summary) return {
			summary,
			speakers: speakers.length ? speakers : speakersFromSummary(summary),
			turns
		};
	} catch {}
	const summary = candidate.trim();
	return {
		summary,
		speakers: speakersFromSummary(summary),
		turns: []
	};
}
async function chat(apiKey, prompt, maxTokens, json) {
	const body = {
		model: MODEL,
		messages: [{
			role: "user",
			content: prompt
		}],
		max_tokens: maxTokens,
		temperature: .15
	};
	if (json) body.response_format = { type: "json_object" };
	const once = async () => {
		const res = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(7e4)
		});
		const raw = await res.text();
		return {
			ok: res.ok,
			status: res.status,
			text: raw
		};
	};
	let result = await once();
	if (!result.ok && (result.status === 429 || result.status >= 500)) {
		await new Promise((r) => setTimeout(r, 800));
		result = await once();
	}
	if (!result.ok && json && result.status === 400) {
		delete body.response_format;
		result = await once();
	}
	if (!result.ok) return null;
	try {
		return JSON.parse(result.text).choices?.[0]?.message?.content?.trim() || null;
	} catch {
		return null;
	}
}
function summaryRules(kind, korean) {
	return [
		"You have read the transcript (or notes covering the whole talk).",
		"Write a SUMMARY of the key content — not a recap that pastes speech.",
		"Cover the opening, the middle arguments, AND the ending. Do not stop after the intro.",
		"Do not quote more than a few words. Do not copy the first caption block.",
		"8–14 short bullets starting with “- ”. Each bullet is one synthesized point.",
		kind === "interview" || kind === "podcast" ? `Name people with real names. Host/interviewer first (use ${korean ? "진행자" : "Host"} if unnamed), then the guest’s real name from the title or transcript.` : "Name people only when the transcript names them.",
		"No preamble, no title heading, no JSON wrapper inside the summary string."
	].join("\n");
}
function finalPrompt(data, material, korean, sample) {
	const host = korean ? "진행자" : "Host";
	const guestEx = korean ? "성상현" : "Guest";
	return [
		`Write a ${data.kind} summary of this video.`,
		`Title: ${data.title || "(untitled)"}`,
		languageHint(data.language, sample),
		KIND_INSTRUCTIONS[data.kind],
		summaryRules(data.kind, korean),
		"Return JSON only:",
		`{ "summary": "- …\\n- …", "speakers": ["${host}","${guestEx}"] }`,
		"speakers: real names in speaking order. Never A, B, or Speaker 1. Empty array if unknown.",
		"",
		"Source material:",
		material
	].join("\n");
}
function partPrompt(data, part, index, total, sample) {
	return [
		`These are captions from part ${index + 1} of ${total} of one ${data.kind}.`,
		`Title: ${data.title || "(untitled)"}`,
		languageHint(data.language, sample),
		"List 5–8 key points from THIS part only. Short bullets. Do not paste speech. Cover claims, numbers, and questions.",
		"Plain text bullets, no JSON.",
		"",
		part
	].join("\n");
}
var summarizeTranscript_createServerFn_handler = createServerRpc({
	id: "894de459b67252a8dbd01860be75f0c4e1a607c59c10584e563d7ac9fc118c57",
	name: "summarizeTranscript",
	filename: "src/lib/intertext/summarize.ts"
}, (opts) => summarizeTranscript.__executeServer(opts));
var summarizeTranscript = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("Invalid summarize payload.");
	if (!isSummaryKind(input.kind)) throw new Error("Invalid summary type.");
	const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs.filter((p) => p && typeof p.text === "string").slice(0, 800).map((p) => ({
		text: p.text.slice(0, 800),
		...typeof p.speaker === "string" && p.speaker ? { speaker: p.speaker.slice(0, 40) } : {}
	})) : [];
	return {
		title: String(input.title ?? "").slice(0, 300),
		language: String(input.language ?? "und").slice(0, 16),
		kind: input.kind,
		paragraphs
	};
}).handler(summarizeTranscript_createServerFn_handler, async ({ data }) => {
	const fallback = fallbackSummary(data.title, data.kind, data.paragraphs);
	const fail = (summary = fallback) => ({
		ok: true,
		summary,
		speakers: speakersFromSummary(summary),
		turns: [],
		source: "fallback"
	});
	const apiKey = process.env.XAI_API_KEY?.trim();
	if (!apiKey) return fail();
	const sample = data.paragraphs.slice(0, 12).map((p) => p.text).join(" ");
	const korean = isKorean(data.language, sample);
	const body = transcriptBody(data.paragraphs);
	if (!body.trim()) return fail();
	try {
		let material = body;
		if (body.length > DIRECT_CHARS) {
			const chunks = chunkTranscript(data.paragraphs);
			const notes = [];
			for (let i = 0; i < chunks.length; i++) {
				const part = await chat(apiKey, partPrompt(data, chunks[i], i, chunks.length, sample), 700, false);
				if (part) notes.push(`Part ${i + 1}:\n${part}`);
			}
			if (notes.length === 0) return fail();
			material = notes.join("\n\n");
		}
		const raw = await chat(apiKey, finalPrompt(data, material, korean, sample), 1400, true);
		if (!raw) return fail();
		const parsed = parseSummaryPayload(raw);
		if (!parsed.summary || isTranscriptDump(parsed.summary, data.paragraphs)) {
			const retry = await chat(apiKey, [
				finalPrompt(data, material, korean, sample),
				"",
				"Your previous answer copied the transcript. Rewrite as distilled key points covering the whole talk. No quotations."
			].join("\n"), 1400, true);
			if (!retry) return fail();
			const again = parseSummaryPayload(retry);
			if (!again.summary || isTranscriptDump(again.summary, data.paragraphs)) return fail();
			return {
				ok: true,
				summary: again.summary,
				speakers: again.speakers,
				turns: [],
				source: "model"
			};
		}
		return {
			ok: true,
			summary: parsed.summary,
			speakers: parsed.speakers,
			turns: [],
			source: "model"
		};
	} catch {
		return fail();
	}
});
//#endregion
export { summarizeTranscript_createServerFn_handler };

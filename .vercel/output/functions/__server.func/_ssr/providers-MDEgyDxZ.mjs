import { a as fillSpeakerGaps, i as explodeSpeakerMarks, r as cueToSegment } from "./speakers-B7cJ0sRR.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/providers-MDEgyDxZ.js
var VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
var YT_HOSTS = /* @__PURE__ */ new Set([
	"youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtube-nocookie.com",
	"youtu.be"
]);
var INVALID_MESSAGE = "That does not look like a YouTube URL or video ID. Use youtube.com/watch, youtu.be, shorts, live, embed, or an 11-character ID.";
function isVideoId(value) {
	return VIDEO_ID_RE.test(value);
}
function canonicalWatchUrl(videoId) {
	return `https://www.youtube.com/watch?v=${videoId}`;
}
function success(videoId, originalInput) {
	return {
		ok: true,
		video: {
			videoId,
			canonicalUrl: canonicalWatchUrl(videoId),
			originalInput
		}
	};
}
function stripIdNoise(token) {
	return token.replace(/[^a-zA-Z0-9_-].*$/, "");
}
function hostAllowed(hostname) {
	const host = hostname.replace(/^www\./, "").toLowerCase();
	if (YT_HOSTS.has(host)) return true;
	return host.endsWith(".youtube.com");
}
function fromPathKind(parts) {
	if (parts.length < 2) return null;
	const kind = parts[0]?.toLowerCase();
	if (!kind) return null;
	if ([
		"shorts",
		"live",
		"embed",
		"v",
		"e",
		"watch"
	].includes(kind)) {
		const id = stripIdNoise(parts[1] ?? "");
		return isVideoId(id) ? id : null;
	}
	return null;
}
function parseYouTubeInput(raw) {
	const originalInput = raw.trim();
	if (!originalInput) return {
		ok: false,
		message: "Paste a YouTube URL or an 11-character video ID."
	};
	if (isVideoId(originalInput)) return success(originalInput, originalInput);
	let url;
	try {
		url = new URL(originalInput.includes("://") ? originalInput : `https://${originalInput}`);
	} catch {
		return {
			ok: false,
			message: INVALID_MESSAGE
		};
	}
	if (!hostAllowed(url.hostname)) return {
		ok: false,
		message: INVALID_MESSAGE
	};
	const host = url.hostname.replace(/^www\./, "").toLowerCase();
	const attribution = url.searchParams.get("u");
	if (attribution) try {
		const innerPath = decodeURIComponent(attribution);
		const nested = parseYouTubeInput(innerPath.startsWith("http") ? innerPath : `https://www.youtube.com${innerPath.startsWith("/") ? "" : "/"}${innerPath}`);
		if (nested.ok) return success(nested.video.videoId, originalInput);
	} catch {}
	if (host === "youtu.be") {
		const id = stripIdNoise(url.pathname.split("/").filter(Boolean)[0] ?? "");
		if (isVideoId(id)) return success(id, originalInput);
		return {
			ok: false,
			message: INVALID_MESSAGE
		};
	}
	const v = url.searchParams.get("v");
	if (v) {
		const id = stripIdNoise(v);
		if (isVideoId(id)) return success(id, originalInput);
		return {
			ok: false,
			message: "The video ID in that URL is not valid. YouTube IDs are 11 characters (letters, numbers, _ or -)."
		};
	}
	const fromPath = fromPathKind(url.pathname.split("/").filter(Boolean));
	if (fromPath) return success(fromPath, originalInput);
	return {
		ok: false,
		message: INVALID_MESSAGE
	};
}
var SENTENCE_END = /[.!?…。？！]["'”’)]*$/;
var HANGUL = /[\uAC00-\uD7A3]/;
var NOISE_ONLY = /^\s*(\[[^\]]+\]|\([^)]+\)|♪+|♫+)\s*$/;
var LEADING_MARK = /^(?:>>|»)+\s*/;
function decodeEntities(input) {
	return input.replace(/&#(\d+);/g, (_, n) => {
		const code = Number(n);
		return Number.isFinite(code) ? String.fromCodePoint(code) : _;
	}).replace(/&#x([0-9a-f]+);/gi, (_, n) => {
		const code = Number.parseInt(n, 16);
		return Number.isFinite(code) ? String.fromCodePoint(code) : _;
	}).replace(/&([a-z]+);/gi, (full, name) => {
		switch (name.toLowerCase()) {
			case "amp": return "&";
			case "lt": return "<";
			case "gt": return ">";
			case "quot": return "\"";
			case "apos": return "'";
			case "nbsp": return " ";
			default: return full;
		}
	});
}
function normalizeCueText(input) {
	return decodeEntities(input).replace(/\u00a0/g, " ").replace(LEADING_MARK, "").replace(/\s*[\[(](?:음악|웃음|박수|intro|music|laughter|applause)[\])]\s*/gi, " ").replace(/\s*\n+\s*/g, " ").replace(/[ \t]+/g, " ").trim();
}
function foldKey(input) {
	return input.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}
function compactLen(input) {
	return foldKey(input).length;
}
function suffixPrefixOverlap(a, b) {
	const max = Math.min(a.length, b.length);
	const floor = max >= 12 ? 4 : 2;
	for (let n = max; n >= floor; n--) if (a.slice(-n) === b.slice(0, n)) return n;
	return 0;
}
function joinCue(prev, next) {
	if (!prev) return next;
	if (!next) return prev;
	if (next.startsWith(prev)) return next;
	if (prev.startsWith(next) && next.length < prev.length) return prev;
	const overlap = suffixPrefixOverlap(prev, next);
	if (overlap > 0) {
		const extra = next.slice(overlap).trim();
		return extra ? `${prev}${prev.endsWith(" ") || extra.startsWith(" ") ? "" : " "}${extra}`.replace(/\s+/g, " ").trim() : prev;
	}
	return `${prev}${/[\s([{‘“"'/-]$/.test(prev) || /^[\s.,!?…。？！)\]’”'"/-]/.test(next) ? "" : " "}${next}`.replace(/\s+/g, " ").trim();
}
function dedupeRepeatedPhrases(text) {
	let t = text.replace(/\s+/g, " ").trim();
	let prev = "";
	for (let i = 0; i < 8 && t !== prev; i++) {
		prev = t;
		t = t.replace(/([^.!?…。？！]{4,}[.!?…。？！])(?:\s*\1)+/g, "$1");
		t = t.replace(/(.{6,}?)\s+\1(?=\s|$|[.!?…。？！])/g, "$1");
		t = t.replace(/([\uAC00-\uD7A3]{2,8})(?:\s*\1){2,}/g, "$1");
		t = t.replace(/\b([A-Za-z]{3,})\b(?:\s+\1\b){2,}/gi, "$1");
	}
	return t.replace(/\s+/g, " ").trim();
}
function pickLonger(prev, next) {
	const a = foldKey(prev);
	const b = foldKey(next);
	if (b.startsWith(a) && b.length > a.length) return next;
	if (a.startsWith(b) && a.length >= b.length) return prev;
	if (b.includes(a) && b.length > a.length) return next;
	if (a.includes(b) && a.length >= b.length) return prev;
	return joinCue(prev, next);
}
function shouldCollapsePair(prev, next, gap) {
	const a = foldKey(prev);
	const b = foldKey(next);
	if (!a || !b) return false;
	if (!(gap < 4.2) && gap >= 0) return false;
	if (a === b) return true;
	if (b.startsWith(a) || a.startsWith(b)) return true;
	if (a.length >= 4 && b.includes(a)) return true;
	if (b.length >= 4 && a.includes(b)) return true;
	const floor = HANGUL.test(prev + next) ? 2 : 4;
	return suffixPrefixOverlap(a, b) >= floor || suffixPrefixOverlap(prev, next) >= floor;
}
/** Collapse rolling-window ASR chips that repeat overlapping prefixes. */
function collapseRollingCaptions(segments) {
	const out = [];
	for (const raw of segments) {
		const text = dedupeRepeatedPhrases(normalizeCueText(raw.text));
		if (!text) continue;
		if (out.length === 0) {
			out.push({
				start: raw.start,
				duration: raw.duration,
				text,
				speaker: raw.speaker
			});
			continue;
		}
		const prev = out[out.length - 1];
		const gap = raw.start - (prev.start + prev.duration);
		if (shouldCollapsePair(prev.text, text, gap) || prev.text === text) {
			prev.text = dedupeRepeatedPhrases(pickLonger(prev.text, text));
			prev.duration = Math.max(prev.duration, raw.start + raw.duration - prev.start);
			continue;
		}
		out.push({
			start: raw.start,
			duration: raw.duration,
			text,
			speaker: raw.speaker
		});
	}
	return out;
}
function isKoreanHeavy(text) {
	const hangul = text.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
	return hangul >= 8 && hangul * 2 >= text.replace(/\s/g, "").length;
}
function shouldBreakSentence(prev, next, elapsed, isKo) {
	if (next.speaker && prev.speaker && next.speaker !== prev.speaker) return true;
	if (next.turnMark && compactLen(prev.text) > 8) return true;
	if (compactLen(prev.text) <= 6 && elapsed < 5) return false;
	if (elapsed >= 3.2) return true;
	if (SENTENCE_END.test(prev.text)) return elapsed >= .25;
	if (!isKo && /[a-z0-9)]$/.test(prev.text) && /^[A-Z]/.test(next.text) && elapsed >= .8) return true;
	if (isKo && /(?:다|요|죠|니다|까요|세요)[.!?…]*$/.test(prev.text) && elapsed >= .45) return true;
	return false;
}
function mergeCues(cues) {
	const out = [];
	for (const cue of cues) {
		const text = dedupeRepeatedPhrases(normalizeCueText(cue.text));
		if (!text || NOISE_ONLY.test(text)) {
			if (text && out.length > 0) {
				const prev = out[out.length - 1];
				if (compactLen(prev.text) < 8) prev.text = joinCue(prev.text, text);
			}
			continue;
		}
		const next = {
			...cue,
			text
		};
		if (out.length === 0) {
			out.push(next);
			continue;
		}
		const prev = out[out.length - 1];
		const elapsed = next.start - (prev.start + prev.duration);
		const isKo = isKoreanHeavy(prev.text + next.text);
		if (shouldCollapsePair(prev.text, next.text, elapsed)) {
			prev.text = dedupeRepeatedPhrases(pickLonger(prev.text, next.text));
			prev.duration = Math.max(.4, next.start + next.duration - prev.start);
			continue;
		}
		if (shouldBreakSentence(prev, next, elapsed, isKo) || prev.duration > 14) out.push(next);
		else {
			prev.text = dedupeRepeatedPhrases(joinCue(prev.text, next.text));
			prev.duration = Math.max(.4, next.start + next.duration - prev.start);
		}
	}
	return out;
}
function speakersDiffer(a, b) {
	return Boolean(a && b && a !== b);
}
function shouldBreakParagraph(prev, next, elapsed, span) {
	if (speakersDiffer(prev.speaker, next.speaker)) return true;
	if (next.turnMark && compactLen(prev.text) > 8) return true;
	if (compactLen(prev.text) <= 6 && elapsed < 5) return false;
	if (elapsed >= 2.6) return true;
	const punctuation = SENTENCE_END.test(prev.text) || /(?:다|요|죠|니다)\.?$/.test(prev.text);
	if (punctuation && elapsed >= .7) return true;
	if (punctuation && span >= 8) return true;
	if (span >= 14) return true;
	return false;
}
function groupCueParagraphs(cues) {
	if (cues.length === 0) return [];
	const paragraphs = [];
	let bucket = [];
	let start = cues[0].start;
	let end = start;
	const flush = () => {
		if (bucket.length === 0) return;
		const text = dedupeRepeatedPhrases(bucket.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim());
		if (text) {
			const speaker = bucket.find((c) => c.speaker)?.speaker;
			const turnMark = bucket.some((c) => c.turnMark);
			paragraphs.push({
				start,
				duration: Math.max(.4, end - start),
				text,
				...speaker ? { speaker } : {},
				...turnMark ? { turnMark: true } : {}
			});
		}
		bucket = [];
	};
	for (const cue of cues) {
		if (bucket.length === 0) {
			bucket = [cue];
			start = cue.start;
			end = cue.start + cue.duration;
			continue;
		}
		const nextEnd = Math.max(end, cue.start + cue.duration);
		const elapsed = cue.start - end;
		const span = nextEnd - start;
		const last = bucket[bucket.length - 1];
		if (shouldCollapsePair(last.text, cue.text, elapsed)) {
			last.text = dedupeRepeatedPhrases(pickLonger(last.text, cue.text));
			last.duration = Math.max(last.duration, cue.start + cue.duration - last.start);
			end = nextEnd;
			continue;
		}
		if (shouldBreakParagraph(last, cue, elapsed, span)) {
			flush();
			bucket = [cue];
			start = cue.start;
			end = cue.start + cue.duration;
		} else {
			bucket.push(cue);
			end = nextEnd;
		}
	}
	flush();
	return mergeContainedParagraphs(paragraphs);
}
function mergeContainedParagraphs(paragraphs) {
	const out = [];
	for (const p of paragraphs) {
		const text = dedupeRepeatedPhrases(p.text);
		if (!text) continue;
		if (out.length === 0) {
			out.push({
				...p,
				text
			});
			continue;
		}
		const prev = out[out.length - 1];
		const gap = p.start - (prev.start + prev.duration);
		if (shouldCollapsePair(prev.text, text, gap) || gap < 1.2 && foldKey(prev.text) === foldKey(text)) {
			prev.text = dedupeRepeatedPhrases(pickLonger(prev.text, text));
			prev.duration = Math.max(prev.duration, p.start + p.duration - prev.start);
			if (p.speaker && !prev.speaker) prev.speaker = p.speaker;
			continue;
		}
		out.push({
			...p,
			text
		});
	}
	return out;
}
function cleanTranscript(raw) {
	const collapsed = collapseRollingCaptions(raw);
	const exploded = explodeSpeakerMarks(collapsed);
	const sentences = mergeCues(exploded.length > 0 ? exploded : collapsed.map((s) => ({ ...s })));
	const paragraphs = groupCueParagraphs(sentences.length > 0 ? sentences : exploded);
	const withSpeakers = paragraphs.some((p) => p.speaker) ? fillSpeakerGaps(paragraphs) : paragraphs;
	const segs = (sentences.length > 0 ? sentences : exploded).map(cueToSegment);
	return {
		segments: segs.length > 0 ? segs : collapsed,
		paragraphs: withSpeakers.length > 0 ? withSpeakers : segs
	};
}
function formatTimestamp(seconds) {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor(s % 3600 / 60);
	const sec = s % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
	return `${m}:${String(sec).padStart(2, "0")}`;
}
function formatDurationClock(seconds) {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor(s % 3600 / 60);
	const sec = s % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
	return `${sec}s`;
}
function formatSrtTime(seconds) {
	const totalMs = Math.max(0, Math.round(seconds * 1e3));
	const h = Math.floor(totalMs / 36e5);
	const m = Math.floor(totalMs % 36e5 / 6e4);
	const s = Math.floor(totalMs % 6e4 / 1e3);
	const ms = totalMs % 1e3;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
function visibleTranscript(paragraphs, mode) {
	const lines = [];
	let lastSpeaker;
	paragraphs.forEach((paragraph, i) => {
		const ts = mode === "off" ? "" : `[${formatTimestamp(paragraph.start)}] `;
		const body = paragraph.text;
		if (mode === "srt") {
			if (lines.length) lines.push("");
			const speaker = paragraph.speaker ? `${paragraph.speaker}: ` : "";
			lines.push(`${i + 1}`);
			lines.push(`${speaker}${ts}${body}`.trim());
			lastSpeaker = paragraph.speaker;
			return;
		}
		if (paragraph.speaker) {
			if (paragraph.speaker !== lastSpeaker) {
				if (lines.length) lines.push("");
				lines.push(`${paragraph.speaker}: ${ts}${body}`.trim());
			} else {
				lines.push("");
				lines.push(`${ts}${body}`.trim());
			}
			lastSpeaker = paragraph.speaker;
			return;
		}
		if (lines.length) lines.push("");
		lines.push(`${ts}${body}`.trim());
		lastSpeaker = void 0;
	});
	return lines.join("\n");
}
function wordCount(text) {
	const hangul = text.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
	const latin = text.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)?.length ?? 0;
	if (hangul > latin * 3) return hangul;
	return latin + hangul;
}
function estimatedReadMinutes(text, language) {
	const count = wordCount(text);
	const wpm = language.toLowerCase().startsWith("ko") || HANGUL.test(text) ? 380 : 220;
	return Math.max(1, Math.round(count / wpm) || 1);
}
function langMatches(code, want) {
	const c = code.toLowerCase();
	const w = want.toLowerCase();
	return c === w || c.startsWith(`${w}-`) || w.startsWith(`${c}-`);
}
function pickTrack(tracks, requested) {
	if (tracks.length === 0) return null;
	const ranked = (want) => {
		const matches = tracks.filter((t) => langMatches(t.languageCode, want));
		return matches.find((t) => t.sourceType === "manual") ?? matches[0] ?? null;
	};
	if (requested !== "auto") return ranked(requested);
	return ranked("ko") ?? ranked("en") ?? tracks.find((t) => t.sourceType === "manual") ?? tracks[0] ?? null;
}
var YTAI = "youtube-transcript.ai";
var INNERTUBE = "YouTube Innertube";
var FETCH_MS = 18e3;
function abortAfter(ms) {
	return AbortSignal.timeout(ms);
}
async function fetchOk(url, init, ms = FETCH_MS) {
	return fetch(url, {
		...init,
		signal: abortAfter(ms)
	});
}
function classifyPlayability(status, reason) {
	const s = (status ?? "").toUpperCase();
	const r = (reason ?? "").toLowerCase();
	if (!s && !r) return null;
	if (r.includes("age") || r.includes("inappropriate") || r.includes("confirm your age")) return {
		code: "age_restricted",
		message: "This video is age-restricted. YouTube hides captions from unsigned requests. Open it on YouTube while signed in, then More → Show transcript.",
		details: reason
	};
	if (r.includes("members-only") || r.includes("members only") || r.includes("join this channel")) return {
		code: "members_only",
		message: "This looks members-only. Public caption providers cannot read it.",
		details: reason
	};
	if (s === "LOGIN_REQUIRED" && r.includes("private")) return {
		code: "unavailable",
		message: "YouTube says this video is private. Public captions are not available.",
		details: reason
	};
	if (s === "UNPLAYABLE" || s === "ERROR" || r.includes("unavailable") || r.includes("not available")) return {
		code: "unavailable",
		message: "YouTube says this video is unavailable. It may be private, deleted, or region-locked.",
		details: reason
	};
	return null;
}
function languageMissing(want, tracks) {
	const available = tracks.map((t) => `${t.languageCode}${t.isAutoGenerated ? " (auto)" : ""}`).join(", ");
	const fallback = pickTrack(tracks, "auto");
	return {
		code: "language_missing",
		message: `No ${want === "ko" ? "Korean" : "English"} captions on this video.${available ? ` Available: ${available}.` : ""} Extract a fallback language instead?`,
		availableLanguages: tracks,
		fallbackLang: fallback?.languageCode
	};
}
function noCaptionsError() {
	return {
		code: "no_captions",
		message: "No public captions were found for this video. On YouTube: More → Show transcript → copy, or extract locally with yt-dlp."
	};
}
function networkError(details) {
	return {
		code: "network",
		message: "Network error reaching caption providers. Check your connection and try again.",
		details
	};
}
function blockedError(details) {
	return {
		code: "provider_blocked",
		message: "Caption providers were blocked or rate-limited. Wait a moment and retry, or copy the transcript from YouTube (More → Show transcript).",
		details
	};
}
function toJob(videoId, requestedLang, capture) {
	const cleaned = cleanTranscript(capture.segments);
	const durationSec = capture.durationSec || cleaned.segments.reduce((max, s) => Math.max(max, s.start + s.duration), 0);
	return {
		videoId,
		url: canonicalWatchUrl(videoId),
		title: capture.title || videoId,
		language: capture.language,
		requestedLang,
		sourceType: capture.sourceType,
		provider: capture.provider,
		providerLabel: capture.providerLabel,
		segmentCount: cleaned.segments.length,
		durationSec,
		createdAt: Date.now(),
		segments: cleaned.segments,
		paragraphs: cleaned.paragraphs,
		availableLanguages: capture.availableLanguages,
		summaryKind: "general",
		summary: ""
	};
}
function parseDuration(raw) {
	const parts = raw.trim().split(":").map(Number);
	if (parts.some((n) => !Number.isFinite(n))) return 0;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return Number.isFinite(parts[0]) ? parts[0] : 0;
}
function parseTimestampToken(token) {
	const m = token.match(/^\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]$/);
	if (!m) return null;
	const h = m[1] ? Number(m[1]) : 0;
	const min = Number(m[2]);
	const sec = Number(m[3]);
	return h * 3600 + min * 60 + sec;
}
function parseAvailableLangs(line) {
	const tracks = [];
	const re = /([a-zA-Z][\w-]*)\s*\(([\w-]+)\)(\s*\[auto\])?/g;
	let match;
	while (match = re.exec(line)) {
		const languageCode = match[2] ?? match[1] ?? "und";
		const isAuto = Boolean(match[3]) || (match[1] ?? "").startsWith("a-");
		tracks.push({
			languageCode,
			sourceType: isAuto ? "asr" : "manual",
			isAutoGenerated: isAuto
		});
	}
	return tracks;
}
function parseYtaiMarkdown(markdown, videoId) {
	const text = markdown.replace(/^\uFEFF/, "");
	if (/transcript unavailable/i.test(text.slice(0, 400))) {
		const reason = text.match(/Reason:\s*(\{[\s\S]*?\}|[^\n]+)/)?.[1] ?? text.slice(0, 280);
		const lower = reason.toLowerCase();
		if (lower.includes("age")) return {
			code: "age_restricted",
			message: "This video is age-restricted. YouTube hides captions from unsigned requests. Open it on YouTube while signed in, then More → Show transcript.",
			details: reason
		};
		if (lower.includes("member")) return {
			code: "members_only",
			message: "This looks members-only. Public caption providers cannot read it.",
			details: reason
		};
		if (lower.includes("unavailable") || lower.includes("private")) return {
			code: "unavailable",
			message: "YouTube says this video is unavailable. It may be private, deleted, or region-locked.",
			details: reason
		};
		if (lower.includes("caption") || lower.includes("transcript") || lower.includes("subtitle")) return noCaptionsError();
		return {
			code: "unavailable",
			message: "The caption provider could not read this video. It may be private, deleted, or missing public captions.",
			details: reason
		};
	}
	const title = text.match(/^#\s*Transcript:\s*(.+)$/m)?.[1]?.trim() || text.match(/^#\s+(.+)$/m)?.[1]?.trim() || videoId;
	const langLine = text.match(/^Language:\s*(.+)$/m)?.[1] ?? "";
	const language = ((langLine.split(/[·•|,]/)[0]?.trim() ?? "").split(/\s+/)[0] || "und").replace(/[^A-Za-z0-9-]/g, "") || "und";
	const isAuto = /\[auto\]/i.test(langLine) || /\basr\b/i.test(langLine) || /auto-generated/i.test(langLine);
	const durationToken = langLine.match(/Duration:\s*([\d:]+)/i)?.[1] ?? "";
	const availableLanguages = parseAvailableLangs(text.match(/^Other available languages:\s*(.+)$/m)?.[1] ?? "");
	if (language && !availableLanguages.some((t) => langMatches(t.languageCode, language))) availableLanguages.unshift({
		languageCode: language,
		sourceType: isAuto ? "asr" : "manual",
		isAutoGenerated: isAuto
	});
	const bodyMatch = text.split(/^##\s*Transcript\s*$/m)[1] ?? text;
	const lines = bodyMatch.split(/\n/);
	const chunks = [];
	let current = null;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("To request") || trimmed.startsWith("Interactive version")) continue;
		const ts = trimmed.match(/^(\[(?:\d{1,2}:)?\d{1,2}:\d{2}\])\s*(.*)$/);
		if (ts) {
			const start = parseTimestampToken(ts[1] ?? "");
			if (start == null) continue;
			if (current) chunks.push(current);
			current = {
				start,
				text: ts[2] ?? ""
			};
		} else if (current) current.text = `${current.text} ${trimmed}`.trim();
	}
	if (current) chunks.push(current);
	if (chunks.length === 0) {
		const fallback = bodyMatch.replace(/^#.+$/gm, "").replace(/^Source video:.*$/gm, "").replace(/^Language:.*$/gm, "").replace(/^Other available.*$/gm, "").replace(/^To request.*$/gm, "").replace(/^Interactive version.*$/gm, "").replace(/^##\s*Transcript\s*$/gm, "").trim();
		if (!fallback) return noCaptionsError();
		chunks.push({
			start: 0,
			text: fallback
		});
	}
	const durationSec = parseDuration(durationToken);
	const segments = chunks.map((chunk, i) => {
		const next = chunks[i + 1];
		const duration = next ? Math.max(.4, next.start - chunk.start) : Math.max(.4, 4);
		return {
			start: chunk.start,
			duration,
			text: chunk.text
		};
	});
	return {
		title,
		language,
		sourceType: isAuto ? "asr" : "manual",
		segments,
		availableLanguages,
		durationSec,
		provider: "youtube-transcript.ai",
		providerLabel: YTAI
	};
}
async function fetchYtaiOnce(videoId, attempt) {
	const url = attempt ? `https://youtube-transcript.ai/transcript/${videoId}.txt?lang=${encodeURIComponent(attempt)}` : `https://youtube-transcript.ai/transcript/${videoId}.txt`;
	try {
		const res = await fetchOk(url, { headers: { Accept: "text/markdown, text/plain; q=0.9, */*; q=0.1" } }, 14e3);
		if (res.status === 429 || res.status === 403) return blockedError(`youtube-transcript.ai HTTP ${res.status}`);
		const body = await res.text();
		if (!body.trim()) return "network";
		return parseYtaiMarkdown(body, videoId);
	} catch (err) {
		if (err instanceof DOMException && err.name === "TimeoutError") return "network";
		return "network";
	}
}
function isHardFail(error) {
	return error.code === "unavailable" || error.code === "age_restricted" || error.code === "members_only" || error.code === "provider_blocked";
}
async function providerYtai(videoId, lang) {
	if (lang === "auto") {
		const fallback = await fetchYtaiOnce(videoId, void 0);
		if (fallback !== "network" && "code" in fallback) {
			if (isHardFail(fallback)) return fallback;
		} else if (fallback !== "network") {
			if (langMatches(fallback.language, "ko")) return fallback;
			if (fallback.availableLanguages.some((t) => langMatches(t.languageCode, "ko"))) {
				const ko = await fetchYtaiOnce(videoId, "ko");
				if (ko !== "network" && !("code" in ko) && langMatches(ko.language, "ko")) return ko;
			}
			if (langMatches(fallback.language, "en")) return fallback;
			if (fallback.availableLanguages.some((t) => langMatches(t.languageCode, "en")) && !langMatches(fallback.language, "en")) {
				const en = await fetchYtaiOnce(videoId, "en");
				if (en !== "network" && !("code" in en) && langMatches(en.language, "en")) return en;
			}
			return fallback;
		}
	}
	const langsToTry = lang === "auto" ? [
		"ko",
		"en",
		void 0
	] : [lang];
	let last = null;
	const seen = /* @__PURE__ */ new Set();
	for (const attempt of langsToTry) {
		const key = attempt ?? "*";
		if (seen.has(key)) continue;
		seen.add(key);
		const parsed = await fetchYtaiOnce(videoId, attempt);
		last = parsed;
		if (parsed !== "network" && "code" in parsed) {
			if (isHardFail(parsed)) return parsed;
			continue;
		}
		if (parsed === "network") continue;
		if (lang !== "auto" && !langMatches(parsed.language, lang)) continue;
		if (lang === "auto" && attempt === "ko" && !langMatches(parsed.language, "ko")) continue;
		return parsed;
	}
	if (last && last !== "network" && !("code" in last)) {
		if (lang !== "auto" && !langMatches(last.language, lang)) return languageMissing(lang, last.availableLanguages);
		return last;
	}
	if (last && last !== "network" && "code" in last) return last;
	return "network";
}
function trackName(track) {
	if (typeof track.name === "string") return track.name;
	return track.name?.simpleText;
}
function mapInnertubeTracks(tracks) {
	return tracks.map((t) => {
		const asr = t.kind === "asr";
		return {
			languageCode: t.languageCode || "und",
			languageName: trackName(t),
			sourceType: asr ? "asr" : "manual",
			isAutoGenerated: asr
		};
	});
}
function pickInnertubeTrack(tracks, requested) {
	const chosen = pickTrack(mapInnertubeTracks(tracks), requested);
	if (!chosen) return null;
	return tracks.find((t) => {
		const asr = t.kind === "asr";
		return langMatches(t.languageCode, chosen.languageCode) && (asr ? "asr" : "manual") === chosen.sourceType;
	}) ?? null;
}
function withJson3(baseUrl) {
	if (/[?&]fmt=/.test(baseUrl)) return baseUrl.replace(/([?&]fmt=)[^&]*/i, "$1json3");
	return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
}
function parseJson3(payload) {
	const data = JSON.parse(payload);
	const segments = [];
	for (const event of data.events ?? []) {
		const trimmed = (event.segs ?? []).map((s) => s.utf8 ?? "").filter((s) => s && s !== "\n").join("").replace(/\s+/g, " ").trim();
		if (!trimmed) continue;
		segments.push({
			start: (event.tStartMs ?? 0) / 1e3,
			duration: (event.dDurationMs ?? 1e3) / 1e3,
			text: trimmed
		});
	}
	return segments;
}
function parseTimedtextXml(xml) {
	const segments = [];
	const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
	let match;
	while (match = re.exec(xml)) {
		const attrs = match[1] ?? "";
		const t = Number(attrs.match(/\bt="(\d+)"/)?.[1] ?? "0");
		const d = Number(attrs.match(/\bd="(\d+)"/)?.[1] ?? "1000");
		const text = decodeEntities((match[2] ?? "").replace(/<s\b[^>]*>/gi, "").replace(/<\/s>/gi, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
		if (!text) continue;
		segments.push({
			start: t / 1e3,
			duration: d / 1e3,
			text
		});
	}
	return segments;
}
async function extractViaYtai(videoId, lang) {
	const first = await providerYtai(videoId, lang);
	if (first !== "network" && !("code" in first)) {
		if (lang !== "auto" && !langMatches(first.language, lang)) return null;
		return {
			ok: true,
			job: toJob(videoId, lang, first)
		};
	}
	return null;
}
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function extractJsonAfter(html, token) {
	const i = html.indexOf(token);
	if (i < 0) return null;
	const start = html.indexOf("{", i);
	if (start < 0) return null;
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let j = start; j < html.length; j++) {
		const ch = html[j];
		if (inStr) {
			if (esc) {
				esc = false;
				continue;
			}
			if (ch === "\\") {
				esc = true;
				continue;
			}
			if (ch === "\"") inStr = false;
			continue;
		}
		if (ch === "\"") {
			inStr = true;
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) try {
				return JSON.parse(html.slice(start, j + 1));
			} catch {
				return null;
			}
		}
	}
	return null;
}
async function postInnertube(videoId, clientName, clientVersion, extra = {}) {
	try {
		const res = await fetchOk("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": BROWSER_UA
			},
			body: JSON.stringify({
				context: { client: {
					clientName,
					clientVersion,
					hl: "en",
					gl: "US",
					...extra
				} },
				videoId
			})
		}, 14e3);
		if (res.status === 429 || res.status === 403) return null;
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}
async function playerFromWatchPage(videoId) {
	try {
		const res = await fetchOk(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, { headers: {
			"User-Agent": BROWSER_UA,
			Accept: "text/html,application/xhtml+xml"
		} }, 14e3);
		if (!res.ok) return null;
		const parsed = extractJsonAfter(await res.text(), "ytInitialPlayerResponse");
		if (parsed && typeof parsed === "object") return parsed;
		return null;
	} catch {
		return null;
	}
}
async function loadPlayer(videoId) {
	const vr = await postInnertube(videoId, "ANDROID_VR", "1.57.29", { androidSdkVersion: 32 });
	if (vr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return vr;
	const web = await postInnertube(videoId, "WEB", "2.20240101.00.00");
	if (web?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return web;
	const page = await playerFromWatchPage(videoId);
	if (page) return page;
	if (vr) return vr;
	if (web) return web;
	return blockedError("Innertube and the watch page returned no player payload.");
}
async function providerInnertube(videoId, lang) {
	const playerOrErr = await loadPlayer(videoId);
	if ("code" in playerOrErr) return playerOrErr;
	const player = playerOrErr;
	const playability = classifyPlayability(player.playabilityStatus?.status, player.playabilityStatus?.reason);
	const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
	const mapped = mapInnertubeTracks(tracks);
	const title = player.videoDetails?.title || videoId;
	const durationSec = Number(player.videoDetails?.lengthSeconds ?? 0);
	if (tracks.length === 0) return playability ?? noCaptionsError();
	const chosen = pickInnertubeTrack(tracks, lang);
	if (!chosen) {
		if (lang !== "auto") return languageMissing(lang, mapped);
		return noCaptionsError();
	}
	if (lang !== "auto" && !langMatches(chosen.languageCode, lang)) return languageMissing(lang, mapped);
	const timedtextUrl = withJson3(chosen.baseUrl);
	try {
		const capRes = await fetchOk(timedtextUrl, { headers: {
			"User-Agent": "com.google.android.apps.youtube.vr.oculus/1.57.29 (Linux; U; Android 12; XR)",
			Accept: "application/json, text/xml; q=0.9, */*; q=0.1"
		} }, 16e3);
		if (!capRes.ok) return blockedError(`timedtext HTTP ${capRes.status}`);
		const body = await capRes.text();
		if (!body.trim()) return blockedError("timedtext returned an empty body (likely bot-check / PO token).");
		let segments = [];
		const trimmed = body.trim();
		if (trimmed.startsWith("{")) try {
			segments = parseJson3(trimmed);
		} catch {
			segments = [];
		}
		if (segments.length === 0 && trimmed.startsWith("<")) segments = parseTimedtextXml(trimmed);
		if (segments.length === 0) return noCaptionsError();
		const asr = chosen.kind === "asr";
		return {
			title,
			language: chosen.languageCode,
			sourceType: asr ? "asr" : "manual",
			segments,
			availableLanguages: mapped,
			durationSec,
			provider: "innertube",
			providerLabel: INNERTUBE
		};
	} catch (err) {
		return networkError(err instanceof Error ? err.message : "timedtext failed");
	}
}
async function runWaterfall(videoId, lang) {
	const first = await providerYtai(videoId, lang);
	if (first !== "network" && !("code" in first)) {
		if (lang !== "auto" && !langMatches(first.language, lang)) return {
			ok: false,
			error: languageMissing(lang, first.availableLanguages)
		};
		return {
			ok: true,
			job: toJob(videoId, lang, first)
		};
	}
	const second = await providerInnertube(videoId, lang);
	if (!("code" in second)) return {
		ok: true,
		job: toJob(videoId, lang, second)
	};
	if (first !== "network" && "code" in first) {
		if (first.code === "language_missing" && second.code === "language_missing") return {
			ok: false,
			error: second
		};
		if (first.code !== "network") {
			if (second.code === "no_captions" || second.code === "language_missing") return {
				ok: false,
				error: second
			};
			return {
				ok: false,
				error: first
			};
		}
	}
	return {
		ok: false,
		error: second
	};
}
//#endregion
export { formatSrtTime as a, parseYouTubeInput as c, wordCount as d, formatDurationClock as i, runWaterfall as l, estimatedReadMinutes as n, formatTimestamp as o, extractViaYtai as r, isVideoId as s, canonicalWatchUrl as t, visibleTranscript as u };

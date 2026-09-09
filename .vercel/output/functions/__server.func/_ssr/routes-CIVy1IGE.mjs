import { i as __toESM } from "../_runtime.mjs";
import { M as isRedirect, R as require_react, _ as useRouter, v as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { n as attachSpeakersToSegments, o as labelInterviewByRole, s as speakersFromSummary, t as applySpeakerNames } from "./speakers-B7cJ0sRR.mjs";
import { a as formatSrtTime, c as parseYouTubeInput, d as wordCount, i as formatDurationClock, n as estimatedReadMinutes, o as formatTimestamp, r as extractViaYtai, s as isVideoId, t as canonicalWatchUrl, u as visibleTranscript } from "./providers-MDEgyDxZ.mjs";
import { a as Moon, c as FileText, d as Copy, f as CircleAlert, i as Search, l as FileJson, o as Monitor, p as Check, r as Sun, s as LoaderCircle, t as X, u as Download } from "../_libs/lucide-react.mjs";
import { n as THEME_MODES, r as useThemeStore } from "./router-BbU7qyNd.mjs";
import { n as isSummaryKind, t as SUMMARY_KINDS } from "./types-CBU5YDVN.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CIVy1IGE.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function useServerFn(serverFn) {
	const router = useRouter();
	return import_react.useCallback(async (...args) => {
		try {
			const res = await serverFn(...args);
			if (isRedirect(res)) throw res;
			return res;
		} catch (err) {
			if (isRedirect(err)) {
				err.options._fromLocation = router.stores.location.get();
				return router.navigate(router.resolveRedirect(err).options);
			}
			throw err;
		}
	}, [router, serverFn]);
}
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[color,background-color,box-shadow,transform,opacity] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 active:enabled:scale-96 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", {
	variants: {
		variant: {
			default: "bg-accent text-accent-fg hover:bg-accent-hover",
			secondary: "border border-border bg-panel text-fg hover:bg-panel-2",
			outline: "border border-border bg-transparent text-fg hover:bg-panel-2",
			ghost: "text-muted hover:bg-panel-2 hover:text-fg",
			danger: "bg-danger/15 text-danger hover:bg-danger/25"
		},
		size: {
			default: "h-11 min-h-11 px-4 text-sm",
			sm: "h-9 min-h-9 px-3 text-sm",
			lg: "h-11 min-h-11 px-5 text-sm sm:h-12 sm:min-h-12",
			wrap: "h-auto min-h-11 px-3 py-2 text-sm"
		}
	},
	defaultVariants: {
		variant: "default",
		size: "default"
	}
});
function Button({ className, variant, size, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: cn(buttonVariants({
			variant,
			size
		}), className),
		...props
	});
}
function Input({ className, type = "text", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
		type,
		className: cn("flex h-12 min-h-12 w-full rounded-md border border-border bg-panel px-4 text-base text-fg transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-subtle", "focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg", "disabled:cursor-not-allowed disabled:opacity-50", className),
		...props
	});
}
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var extractTranscript = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || !isVideoId(input.videoId)) throw new Error("Invalid video ID.");
	if (input.lang !== "auto" && input.lang !== "ko" && input.lang !== "en") throw new Error("Invalid language.");
	return {
		videoId: input.videoId,
		lang: input.lang
	};
}).handler(createSsrRpc("e5ac9cd43c95a6903fc6c1c22e2e9a2bff5764bd2c32177927fd65e1b35beb6a"));
async function withOembedTitle(result, videoId) {
	if (!result.ok) return result;
	if (result.job.title && result.job.title !== videoId) return result;
	try {
		const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalWatchUrl(videoId))}&format=json`);
		if (!res.ok) return result;
		const data = await res.json();
		if (typeof data.title === "string" && data.title.trim()) return {
			ok: true,
			job: {
				...result.job,
				title: data.title.trim()
			}
		};
	} catch {}
	return result;
}
async function extractCaptions(videoId, lang, serverExtract = (opts) => extractTranscript(opts)) {
	try {
		const direct = await extractViaYtai(videoId, lang);
		if (direct) return withOembedTitle(direct, videoId);
	} catch {}
	try {
		return withOembedTitle(await serverExtract({ data: {
			videoId,
			lang
		} }), videoId);
	} catch (err) {
		const details = err instanceof Error ? err.message : "Caption providers could not be reached.";
		const lower = details.toLowerCase();
		const blocked = lower.includes("403") || lower.includes("429") || lower.includes("blocked");
		return {
			ok: false,
			error: {
				code: blocked ? "provider_blocked" : "network",
				message: blocked ? "Caption providers were blocked or rate-limited. Wait a moment and retry, or copy the transcript from YouTube (More → Show transcript)." : "Network error reaching caption providers. Check your connection and try again.",
				details
			}
		};
	}
}
var KEY = "intertext.jobs.v2";
var LIMIT = 10;
function canUseStorage() {
	return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}
function loadJobs() {
	if (!canUseStorage()) return [];
	try {
		const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem("intertext.jobs.v1");
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isJob).slice(0, LIMIT);
	} catch {
		return [];
	}
}
function isJob(value) {
	if (!value || typeof value !== "object") return false;
	const v = value;
	return typeof v.videoId === "string" && typeof v.url === "string" && Array.isArray(v.segments) && Array.isArray(v.paragraphs);
}
function withJobDefaults(job) {
	const kind = isSummaryKind(String(job.summaryKind ?? "")) ? job.summaryKind : "general";
	return {
		...job,
		summaryKind: kind,
		summary: typeof job.summary === "string" ? job.summary : ""
	};
}
function saveJobs(jobs) {
	const next = jobs.map(withJobDefaults).slice(0, LIMIT);
	if (!canUseStorage()) return next;
	for (let n = next.length; n >= 0; n--) try {
		window.localStorage.setItem(KEY, JSON.stringify(next.slice(0, n)));
		return n === next.length ? next : next.slice(0, n);
	} catch {}
	return next;
}
function upsertJob(jobs, job) {
	const rest = jobs.filter((j) => j.videoId !== job.videoId || j.language !== job.language);
	return saveJobs([withJobDefaults(job), ...rest]);
}
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
}).handler(createSsrRpc("894de459b67252a8dbd01860be75f0c4e1a607c59c10584e563d7ac9fc118c57"));
function paragraphPayload(paragraphs) {
	return paragraphs.map((p) => ({
		text: p.text,
		...p.speaker ? { speaker: p.speaker } : {}
	}));
}
var EXAMPLES = [
	{
		label: "Watch URL",
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
	},
	{
		label: "Short link",
		url: "https://youtu.be/8S0FDjFBj8o"
	},
	{
		label: "Shorts",
		url: "https://www.youtube.com/shorts/aqz-KE-bpKQ"
	}
];
var STEPS = [
	"Paste a public YouTube URL and pick a summary type (General, Meeting, Course, Interview, or Podcast).",
	"INTERTEXT reads the public caption track, collapses rolling auto-captions, then writes a summary.",
	"The file is title → summary → transcript, using real speaker names. Copy or download it under the same title as the video."
];
function EmptyState({ onPick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "theme-surface rounded-xl border border-border bg-panel p-5 sm:p-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-serif text-xl tracking-tight",
				children: "How it works"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
				className: "mt-4 space-y-3",
				children: STEPS.map((step, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex gap-3 text-sm leading-relaxed text-muted",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-serif text-lg leading-none text-accent-text tabular-nums",
						children: i + 1
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: step })]
				}, step))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "label-caps mt-6 text-subtle",
				children: "Example URLs"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-2 space-y-2",
				children: EXAMPLES.map((ex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "ghost",
					size: "wrap",
					className: "h-auto w-full justify-start px-3 py-3 text-left hover:bg-panel-2",
					onClick: () => onPick(ex.url),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "flex min-w-0 flex-col gap-0.5",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "label-caps text-subtle",
							children: ex.label
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "truncate font-mono text-xs text-fg",
							children: ex.url
						})]
					})
				}) }, ex.url))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-sm text-muted",
				children: "Korean and English both work. Interview mode names the host and guest from the talk — it does not invent A/B dialogue."
			})
		]
	});
}
function ExtractSkeleton({ progress }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "theme-surface rounded-xl border border-border bg-panel px-5 py-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "flex items-center gap-3 text-sm text-muted",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "size-4 animate-spin text-accent-text" }), progress]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-subtle",
				children: "Public caption tracks only — the video is not downloaded. Summary is written after the transcript is cleaned."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-5 space-y-3",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "skeleton-pulse h-8 w-2/3 rounded-md" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "skeleton-pulse h-3 w-full rounded-sm" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "skeleton-pulse h-3 w-11/12 rounded-sm" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "skeleton-pulse h-3 w-4/5 rounded-sm" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "skeleton-pulse mt-4 h-24 w-full rounded-lg" })
				]
			})
		]
	});
}
function Badge({ className, tone = "neutral", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide", tone === "neutral" && "border-border bg-panel-2 text-muted", tone === "accent" && "border-accent/25 bg-accent/10 text-accent-text", tone === "ok" && "border-ok/25 bg-ok/10 text-ok", tone === "danger" && "border-danger/25 bg-danger/10 text-danger", className),
		...props
	});
}
function sanitizeFilename(title, fallback) {
	return (title || fallback).normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim().slice(0, 120) || fallback;
}
function exportBasename(job) {
	return sanitizeFilename(job.title, job.videoId);
}
function summaryKindLabel(kind) {
	return SUMMARY_KINDS.find((k) => k.id === kind)?.label ?? "General";
}
function composeDocument(job, mode) {
	const title = (job.title || job.videoId).trim();
	const summary = (job.summary || "").trim();
	const body = visibleTranscript(job.paragraphs, mode === "srt" ? "inline" : mode);
	const parts = [title, ""];
	if (summary) parts.push(`Summary (${summaryKindLabel(job.summaryKind)})`, summary, "");
	parts.push(body.trim());
	return `${parts.join("\n").trim()}\n`;
}
function buildTxt(job, mode) {
	return composeDocument(job, mode);
}
function buildMarkdown(job, mode) {
	const kind = job.sourceType === "asr" ? "Auto-generated" : "Manual";
	const body = visibleTranscript(job.paragraphs, mode === "off" ? "off" : "inline");
	const summary = (job.summary || "").trim();
	const lines = [
		`# ${job.title || job.videoId}`,
		"",
		`Source: ${job.url}`,
		`Language: ${job.language} (${kind})`,
		`Provider: ${job.providerLabel}`,
		""
	];
	if (summary) lines.push(`## Summary (${summaryKindLabel(job.summaryKind)})`, "", summary, "");
	lines.push("## Transcript", "", body, "");
	return lines.join("\n");
}
function buildSrt(job) {
	return job.segments.map((seg, i) => {
		const start = formatSrtTime(seg.start);
		const end = formatSrtTime(seg.start + Math.max(seg.duration, .4));
		const speaker = seg.speaker ? `${seg.speaker}: ` : "";
		return `${i + 1}\n${start} --> ${end}\n${speaker}${seg.text}`;
	}).join("\n\n").concat("\n");
}
function buildJson(job) {
	return `${JSON.stringify({
		videoId: job.videoId,
		url: job.url,
		language: job.language,
		sourceType: job.sourceType,
		title: job.title,
		provider: job.provider,
		summaryKind: job.summaryKind,
		summary: job.summary,
		segments: job.segments.map((s) => ({
			start: s.start,
			duration: s.duration,
			text: s.text,
			...s.speaker ? { speaker: s.speaker } : {}
		})),
		paragraphs: job.paragraphs.map((p) => ({
			start: p.start,
			duration: p.duration,
			text: p.text,
			...p.speaker ? { speaker: p.speaker } : {}
		}))
	}, null, 2)}\n`;
}
function downloadUtf8(filename, contents, mime, bom = false) {
	const parts = [];
	if (bom) parts.push(new Uint8Array([
		239,
		187,
		191
	]));
	parts.push(contents);
	const blob = new Blob(parts, { type: `${mime};charset=utf-8` });
	const href = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = href;
	a.download = filename;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(href);
}
function SegmentedControl({ value, onChange, options, "aria-label": ariaLabel, disabled, className, itemClassName }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		role: "radiogroup",
		"aria-label": ariaLabel,
		className: cn("seg-track", className),
		children: options.map((opt) => {
			const on = value === opt.id;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				role: "radio",
				"aria-checked": on,
				"aria-label": opt.ariaLabel,
				disabled,
				onClick: () => onChange(opt.id),
				className: cn("seg-item", itemClassName, on && "seg-item-on"),
				children: opt.label
			}, opt.id);
		})
	});
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function countMatches(text, query) {
	const q = query.trim();
	if (!q) return 0;
	const re = new RegExp(escapeRegExp(q), "gi");
	return text.match(re)?.length ?? 0;
}
function HighlightedText({ text, query }) {
	const q = query.trim();
	if (!q) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: text });
	const re = new RegExp(`(${escapeRegExp(q)})`, "gi");
	const parts = text.split(re);
	if (parts.length === 1) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: text });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: parts.map((part, index) => part.toLowerCase() === q.toLowerCase() ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("mark", {
		className: "mark-hit",
		children: part
	}, `${index}-${part}`) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: part }, `${index}-${part.slice(0, 12)}`)) });
}
function TranscriptView({ paragraphs, mode, query, language }) {
	const q = query.trim();
	const filtered = q.length === 0 ? paragraphs : paragraphs.filter((p) => p.text.toLowerCase().includes(q.toLowerCase()) || p.speaker && p.speaker.toLowerCase().includes(q.toLowerCase()));
	if (paragraphs.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "text-sm text-muted",
		children: "No caption text in this track."
	});
	if (filtered.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "text-sm text-muted",
		children: [
			"No paragraphs match “",
			q,
			"”. Clear search to see the full transcript."
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("article", {
		lang: language,
		className: "max-w-prose space-y-5",
		children: filtered.map((paragraph, index) => {
			const n = paragraphs.indexOf(paragraph) + 1;
			const prev = index > 0 ? filtered[index - 1] : void 0;
			const showSpeaker = Boolean(paragraph.speaker) && paragraph.speaker !== prev?.speaker;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "transcript-block text-pretty text-base leading-read text-fg",
				children: [
					mode === "srt" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "label-caps mb-1 block text-subtle tabular-nums",
						children: n
					}) : null,
					showSpeaker ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "mb-1 block text-sm font-medium tracking-wide text-accent-text",
						children: paragraph.speaker
					}) : null,
					mode !== "off" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "mr-2 font-mono text-xs tabular-nums text-accent-text",
						children: [
							"[",
							formatTimestamp(paragraph.start),
							"]"
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HighlightedText, {
						text: paragraph.text,
						query: q
					})
				]
			}, `${paragraph.start}-${index}`);
		})
	});
}
var TS_OPTIONS = [
	{
		id: "off",
		label: "Off"
	},
	{
		id: "inline",
		label: "Inline"
	},
	{
		id: "srt",
		label: "SRT-style"
	}
];
function ResultPane({ job }) {
	const [tsMode, setTsMode] = (0, import_react.useState)("off");
	const [query, setQuery] = (0, import_react.useState)("");
	const [bom, setBom] = (0, import_react.useState)(true);
	const [copied, setCopied] = (0, import_react.useState)(false);
	const body = (0, import_react.useMemo)(() => visibleTranscript(job.paragraphs, tsMode), [job.paragraphs, tsMode]);
	const fullText = (0, import_react.useMemo)(() => composeDocument(job, tsMode), [job, tsMode]);
	const words = wordCount(body);
	const readMin = estimatedReadMinutes(body, job.language);
	const hits = query.trim() ? countMatches(fullText, query) : 0;
	const kind = job.sourceType === "asr" ? "Auto-generated" : "Manual";
	const base = exportBasename(job);
	const summaryLabel = summaryKindLabel(job.summaryKind);
	async function copyVisible() {
		try {
			await navigator.clipboard.writeText(fullText);
		} catch {
			const area = document.createElement("textarea");
			area.value = fullText;
			area.setAttribute("readonly", "true");
			area.style.position = "fixed";
			area.style.left = "-9999px";
			document.body.appendChild(area);
			area.select();
			document.execCommand("copy");
			area.remove();
		}
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	}
	function download(kindName) {
		if (kindName === "txt") {
			downloadUtf8(`${base}.txt`, buildTxt(job, tsMode), "text/plain", bom);
			return;
		}
		if (kindName === "srt") {
			downloadUtf8(`${base}.srt`, buildSrt(job), "application/x-subrip", false);
			return;
		}
		if (kindName === "md") {
			downloadUtf8(`${base}.md`, buildMarkdown(job, tsMode), "text/markdown", false);
			return;
		}
		downloadUtf8(`${base}.json`, buildJson(job), "application/json", false);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		"aria-label": "Transcript result",
		className: "theme-surface rounded-xl border border-border bg-panel p-4 sm:p-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-serif text-2xl leading-snug tracking-tight text-fg sm:text-3xl",
						children: job.title || job.videoId
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: job.url,
						target: "_blank",
						rel: "noreferrer",
						className: "inline-block break-all text-sm text-muted underline-offset-4 hover:text-accent-text hover:underline",
						children: job.url
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
								tone: "accent",
								children: job.language
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
								tone: job.sourceType === "manual" ? "ok" : "neutral",
								children: kind
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
								tone: "accent",
								children: summaryLabel
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, { children: [job.segmentCount, " segments"] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: formatDurationClock(job.durationSec) }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, { children: ["via ", job.providerLabel] })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "tabular-nums",
								children: words.toLocaleString()
							}),
							" words · about",
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "tabular-nums",
								children: readMin
							}),
							" min read"
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-6 space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "relative",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, {
								className: "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle",
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								value: query,
								onChange: (e) => setQuery(e.target.value),
								placeholder: "Search title, summary, and transcript",
								"aria-label": "Search transcript",
								className: "h-11 min-h-11 pr-11 pl-10"
							}),
							query ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setQuery(""),
								className: "absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg",
								"aria-label": "Clear search",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
							}) : null
						]
					}),
					query.trim() ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs tabular-nums text-muted",
						children: [
							hits,
							" ",
							hits === 1 ? "match" : "matches"
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "label-caps text-subtle",
							children: "Timestamps"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SegmentedControl, {
							"aria-label": "Timestamp mode",
							value: tsMode,
							onChange: setTsMode,
							className: "w-full sm:w-auto",
							itemClassName: "sm:flex-none",
							options: TS_OPTIONS
						})]
					})
				]
			}),
			job.summary ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				"aria-label": "Summary",
				className: "mt-6 border-t border-border pt-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "label-caps text-subtle",
					children: ["Summary · ", summaryLabel]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-3 max-w-prose whitespace-pre-wrap text-base leading-read text-fg",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HighlightedText, {
						text: job.summary,
						query
					})
				})]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				"aria-label": "Transcript",
				className: "mt-6 border-t border-border pt-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "label-caps mb-4 text-subtle",
					children: "Transcript"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TranscriptView, {
					paragraphs: job.paragraphs,
					mode: tsMode,
					query,
					language: job.language
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-6 border-t border-border pt-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid grid-cols-2 gap-2 sm:grid-cols-5",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: copyVisible,
							variant: "ghost",
							className: "col-span-2 sm:col-span-1",
							children: [copied ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Copy, {}), copied ? "Copied" : "Copy text"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: () => download("txt"),
							variant: "ghost",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileText, {}), "TXT"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: () => download("srt"),
							variant: "ghost",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, {}), "SRT"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: () => download("md"),
							variant: "ghost",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileText, {}), "Markdown"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: () => download("json"),
							variant: "ghost",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileJson, {}), "JSON"]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: bom,
						onChange: (e) => setBom(e.target.checked),
						className: "size-4 accent-accent"
					}), "Windows-friendly TXT (UTF-8 BOM)"]
				})]
			})
		]
	});
}
var ICONS = {
	system: Monitor,
	light: Sun,
	dark: Moon
};
var LABELS = {
	system: "System",
	light: "Light",
	dark: "Dark"
};
function ThemeToggle() {
	const mode = useThemeStore((s) => s.mode);
	const setMode = useThemeStore((s) => s.setMode);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		role: "radiogroup",
		"aria-label": "Color theme",
		className: "seg-track shrink-0",
		children: THEME_MODES.map((id) => {
			const Icon = ICONS[id];
			const on = mode === id;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				role: "radio",
				"aria-checked": on,
				"aria-label": LABELS[id],
				title: LABELS[id],
				onClick: () => setMode(id),
				className: cn("seg-item seg-item-sm", on && "seg-item-on"),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
					className: "size-4",
					"aria-hidden": "true"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "sr-only",
					children: LABELS[id]
				})]
			}, id);
		})
	});
}
var LANGS = [
	{
		id: "auto",
		label: "Auto"
	},
	{
		id: "ko",
		label: "Korean"
	},
	{
		id: "en",
		label: "English"
	}
];
function loadingCopy(lang, stage, kind) {
	if (stage === "turns") return "Breaking speaker turns and pauses…";
	if (stage === "summary") return `Writing ${(SUMMARY_KINDS.find((k) => k.id === kind)?.label ?? "General").toLowerCase()} summary…`;
	if (lang === "ko") return "Finding Korean captions…";
	if (lang === "en") return "Finding English captions…";
	return "Finding Korean/English captions…";
}
function languageName(code) {
	const c = code.toLowerCase();
	if (c === "ko" || c.startsWith("ko-")) return "Korean";
	if (c === "en" || c.startsWith("en-")) return "English";
	return code;
}
function relativeTime(ts) {
	const delta = Math.max(0, Date.now() - ts);
	const min = Math.round(delta / 6e4);
	if (min < 1) return "just now";
	if (min < 60) return `${min}m ago`;
	const hrs = Math.round(min / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.round(hrs / 24)}d ago`;
}
function finishJob(job, kind, summary, speakers, turns, source = "fallback") {
	const names = speakers.length > 0 ? speakers : speakersFromSummary(summary);
	let paragraphs = job.paragraphs;
	if (kind === "interview" || kind === "podcast") paragraphs = turns.length > 0 ? applySpeakerNames(job.paragraphs, names, turns) : labelInterviewByRole(job.paragraphs, names);
	else paragraphs = applySpeakerNames(job.paragraphs, names);
	return {
		...job,
		paragraphs,
		segments: attachSpeakersToSegments(job.segments, paragraphs),
		summaryKind: kind,
		summary,
		speakers: names,
		summarySource: source
	};
}
function Workspace() {
	const extractOnServer = useServerFn(extractTranscript);
	const summarizeOnServer = useServerFn(summarizeTranscript);
	const [input, setInput] = (0, import_react.useState)("");
	const [lang, setLang] = (0, import_react.useState)("auto");
	const [summaryKind, setSummaryKind] = (0, import_react.useState)("interview");
	const [status, setStatus] = (0, import_react.useState)("idle");
	const [job, setJob] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const [jobs, setJobs] = (0, import_react.useState)([]);
	const [progress, setProgress] = (0, import_react.useState)("Finding Korean/English captions…");
	const resultRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		setJobs(loadJobs());
	}, []);
	(0, import_react.useEffect)(() => {
		if (status !== "ready" || !job) return;
		const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		resultRef.current?.scrollIntoView({
			behavior: reduce ? "auto" : "smooth",
			block: "start"
		});
	}, [status, job]);
	const statusLabel = (0, import_react.useMemo)(() => {
		if (status === "extracting") return progress;
		if (status === "ready" && job) return `Ready · ${job.providerLabel} · ${job.segmentCount} segments`;
		if (status === "error" && error) return {
			invalid_url: "Error · invalid URL",
			no_captions: "Error · no public captions",
			age_restricted: "Error · age-restricted",
			members_only: "Error · members-only",
			provider_blocked: "Error · provider blocked",
			network: "Error · network",
			language_missing: "Error · language not on this video",
			unavailable: "Error · video unavailable"
		}[error.code] ?? "Error · extraction failed";
		return "Paste a public YouTube URL and choose a summary type.";
	}, [
		status,
		progress,
		job,
		error
	]);
	async function runExtract(raw, requested, kind) {
		const parsed = parseYouTubeInput(raw);
		if (!parsed.ok) {
			setJob(null);
			setError({
				code: "invalid_url",
				message: parsed.message
			});
			setStatus("error");
			return;
		}
		setStatus("extracting");
		setError(null);
		setProgress(loadingCopy(requested, "captions", kind));
		const turnTimer = window.setTimeout(() => {
			setProgress(loadingCopy(requested, "turns", kind));
		}, 1400);
		try {
			const result = await extractCaptions(parsed.video.videoId, requested, extractOnServer);
			if (!result.ok) {
				setJob(null);
				setError(result.error);
				setStatus("error");
				return;
			}
			window.clearTimeout(turnTimer);
			setProgress(loadingCopy(requested, "summary", kind));
			let summary = "";
			let speakers = [];
			let turns = [];
			let source = "fallback";
			try {
				const summed = await summarizeOnServer({ data: {
					title: result.job.title,
					language: result.job.language,
					kind,
					paragraphs: paragraphPayload(result.job.paragraphs)
				} });
				summary = summed.summary;
				speakers = summed.speakers ?? [];
				turns = summed.turns ?? [];
				source = summed.source === "model" ? "model" : "fallback";
			} catch {
				summary = fallbackSummary(result.job.title, kind, result.job.paragraphs);
				source = "fallback";
			}
			const next = finishJob(result.job, kind, summary, speakers, turns, source);
			setJob(next);
			setStatus("ready");
			setJobs((prev) => upsertJob(prev, next));
		} finally {
			window.clearTimeout(turnTimer);
		}
	}
	function onSubmit(event) {
		event.preventDefault();
		runExtract(input, lang, summaryKind);
	}
	function reopen(next) {
		setInput(next.url);
		setLang(next.requestedLang);
		setSummaryKind(next.summaryKind || "interview");
		setJob(next);
		setError(null);
		setStatus("ready");
	}
	const showEmpty = status === "idle" && !job;
	const showResult = job && status !== "extracting";
	const busy = status === "extracting";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-dvh bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "theme-surface sticky top-0 z-30 bg-bg pt-[env(safe-area-inset-top)]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-serif text-2xl tracking-tight italic sm:text-3xl",
							children: "INTERTEXT"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "truncate text-xs text-muted sm:text-sm",
							children: "Public YouTube talks as readable text."
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ThemeToggle, {})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "header-rule" })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				className: "mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						onSubmit,
						className: "theme-surface space-y-5 rounded-xl border border-border bg-panel p-5 shadow-[var(--it-shadow-card)] sm:p-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "space-y-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
									htmlFor: "yt-url",
									className: "text-sm font-medium text-muted",
									children: "YouTube URL or video ID"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									id: "yt-url",
									name: "url",
									value: input,
									onChange: (e) => setInput(e.target.value),
									placeholder: "https://www.youtube.com/watch?v=… or 11-character ID",
									autoComplete: "off",
									spellCheck: false,
									inputMode: "url",
									enterKeyHint: "go",
									disabled: busy,
									"aria-invalid": status === "error" && error?.code === "invalid_url"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "space-y-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm font-medium text-muted",
									children: "Caption language"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SegmentedControl, {
									"aria-label": "Caption language",
									value: lang,
									disabled: busy,
									onChange: setLang,
									options: LANGS.map((opt) => ({
										id: opt.id,
										label: opt.id === "auto" ? opt.label : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [opt.label, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
											className: "ml-1 text-xs text-subtle",
											children: [
												"(",
												opt.id,
												")"
											]
										})] })
									}))
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "space-y-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-sm font-medium text-muted",
										children: "Summary type"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SegmentedControl, {
										"aria-label": "Summary type",
										value: summaryKind,
										disabled: busy,
										className: "seg-grid",
										onChange: setSummaryKind,
										options: SUMMARY_KINDS.map((opt) => ({
											id: opt.id,
											label: opt.label,
											ariaLabel: `${opt.label}. ${opt.hint}`
										}))
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-xs text-subtle",
										children: SUMMARY_KINDS.find((k) => k.id === summaryKind)?.hint
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "submit",
								size: "lg",
								className: "w-full sm:w-auto sm:min-w-44",
								disabled: busy,
								children: busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "animate-spin" }), "Extract"] }) : "Extract"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						role: "status",
						"aria-live": "polite",
						className: status === "error" ? "text-sm text-danger" : status === "ready" ? "text-sm text-ok" : "text-sm text-muted",
						children: statusLabel
					}),
					busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExtractSkeleton, { progress }) : null,
					status === "error" && error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "theme-surface rounded-xl border border-border bg-panel p-5",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "flex items-start gap-2 text-sm text-danger",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleAlert, { className: "mt-0.5 size-4 shrink-0" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: error.message })]
							}),
							error.details ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-2 font-mono text-xs break-words text-subtle",
								children: error.details
							}) : null,
							error.code === "language_missing" && error.fallbackLang ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
								className: "mt-4",
								variant: "secondary",
								onClick: () => {
									const next = error.fallbackLang?.toLowerCase().startsWith("ko") ? "ko" : error.fallbackLang?.toLowerCase().startsWith("en") ? "en" : "auto";
									setLang(next);
									runExtract(input, next, summaryKind);
								},
								children: [
									"Extract ",
									languageName(error.fallbackLang),
									" instead"
								]
							}) : null,
							error.code === "no_captions" || error.code === "provider_blocked" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-3 text-sm text-muted",
								children: [
									"On YouTube: More → Show transcript → copy. Locally:",
									" ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
										className: "font-mono text-xs text-fg",
										children: "yt-dlp --write-subs --skip-download URL"
									})
								]
							}) : null
						]
					}) : null,
					showEmpty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, { onPick: setInput }) : null,
					showResult && job ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						ref: resultRef,
						className: "result-enter scroll-mt-28",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultPane, { job }, `${job.videoId}-${job.language}-${job.createdAt}-${job.summaryKind}`)
					}) : null,
					jobs.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						"aria-label": "Recent jobs",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "label-caps text-subtle",
							children: "Recent"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "theme-surface mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel",
							children: jobs.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => reopen(item),
								className: "flex min-h-14 w-full flex-col gap-1 px-4 py-3 text-left hover:bg-panel-2 sm:flex-row sm:items-center sm:justify-between",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "min-w-0",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "block truncate text-sm text-fg",
										children: item.title || item.videoId
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "block font-mono text-xs text-subtle",
										children: [
											item.videoId,
											" · ",
											item.language,
											item.summaryKind ? ` · ${item.summaryKind}` : ""
										]
									})]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-xs tabular-nums text-subtle",
									children: relativeTime(item.createdAt)
								})]
							}) }, `${item.videoId}-${item.language}-${item.createdAt}`))
						})]
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
				className: "mx-auto max-w-4xl px-4 pb-10 sm:px-6",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs leading-relaxed text-subtle",
					children: "Personal research use only; do not republish copyrighted interviews; this app reads public captions, it does not download the video."
				})
			})
		]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Workspace, {});
}
//#endregion
export { Home as component };

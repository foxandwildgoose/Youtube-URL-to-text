# INTERTEXT — Phase 1 audit

Audited commit: `bc7f84c` ("Export from Grok"), branch `claude/intertext-audit-samqpt`.
Verification runs are at the end of this document (`typecheck`, `test`, `lint`, `build`).

No production code was changed in Phase 1. Two throwaway probe scripts were run from the
scratchpad to confirm behaviour; findings marked **(reproduced)** were executed, not inferred.

---

## A. Architecture summary

### What the app does

INTERTEXT takes a public YouTube URL (or a raw 11-character video ID), fetches the video's
**public caption track**, cleans rolling auto-caption chips into readable paragraphs, optionally
labels speakers and writes a summary, then offers TXT / SRT / Markdown / JSON export. Recent
jobs live in `localStorage`. No audio is downloaded and no speech-to-text is run.

### Real data flow

```
Workspace.runExtract (src/components/intertext/workspace.tsx)
  └─ parseYouTubeInput            src/lib/intertext/parse-url.ts     → videoId
  └─ extractCaptions              src/lib/intertext/client-extract.ts
       ├─ extractViaYtai          src/lib/intertext/providers.ts     [BROWSER, user IP]
       │    └─ providerYtai → fetchYtaiOnce → parseYtaiMarkdown
       ├─ extractTranscript       src/lib/intertext/extract.ts       [SERVER FN, POST]
       │    └─ runWaterfall       src/lib/intertext/providers.ts
       │         ├─ providerYtai        (provider 1, server IP)
       │         └─ providerInnertube   (provider 2)
       │              ├─ loadPlayer: POST youtubei/v1/player ANDROID_VR → WEB
       │              │              → watch-page ytInitialPlayerResponse scrape
       │              └─ timedtext ?fmt=json3  (parseJson3, parseTimedtextXml fallback)
       │         └─ toJob → cleanTranscript   src/lib/intertext/clean.ts
       └─ withOembedTitle         (youtube.com/oembed, browser)
  └─ summarizeTranscript          src/lib/intertext/summarize.ts     [SERVER FN, xAI grok-4.5]
  └─ finishJob                    src/lib/intertext/speakers.ts      (speaker labelling)
  └─ upsertJob                    src/lib/intertext/storage.ts       (localStorage)
  └─ ResultPane                   src/components/intertext/result-pane.tsx
       └─ export.ts               buildTxt / buildSrt / buildMarkdown / buildJson
```

`cleanTranscript` is the quality core: `collapseRollingCaptions` (drop overlapping ASR chips) →
`explodeSpeakerMarks` (split on `>>` / `»`, lift `Name:` prefixes) → `mergeCues` (chips into
sentence-like cues) → `groupCueParagraphs` (~8–20s turns) → `mergeContainedParagraphs`.

### Product code (~2.7k LOC)

| Layer | Files |
| --- | --- |
| Domain | `src/lib/intertext/{types,parse-url,clean,speakers,providers,extract,client-extract,export,storage,summarize}.ts` |
| UI | `src/components/intertext/*` (7 components), `src/routes/index.tsx`, `src/routes/__root.tsx` |
| Shared UI | `src/components/ui/{badge,button,input}.tsx`, `src/lib/utils.ts`, `src/lib/theme.ts`, `src/styles.css` |
| Tests | `src/lib/intertext/{parse-url,clean,export,summarize}.test.ts` |

### Grok-template scaffolding (not product)

| Area | Files | Reachable from the app? |
| --- | --- | --- |
| Better Auth | `src/lib/auth/*` (19 files), `migrations/auth/0001_auth.sql`, the `<AuthProvider>` in `src/routes/__root.tsx` | **No** — `AuthProvider` is a passthrough with no imports; nothing else under `src/routes`, `src/components` or `src/lib/intertext` touches `src/lib/auth`. `.grok/app-env.json` sets `VITE_AUTH_ENABLED: "false"`. |
| Database | `src/lib/db.ts`, `src/lib/app-data/*` (10 files), `scripts/migrate.mjs`, PGLite / Neon / Kysely / pg deps | **No** — no product code imports `@/lib/db`. `migrations/` holds no top-level `.sql`, so `hasGlobbedMigrations` is false and the PGLite dev bootstrap is skipped. `deploy.database` is `false`. |
| Multiplayer | `src/lib/multiplayer/{index,p2p}.ts` | **No** |
| Grok PWA / preview | `scripts/grok-pwa-*.mjs`, `scripts/preview*.mjs`, `scripts/browser-*.mjs`, `server/middleware/grok-pwa.ts`, `public/__grok/*`, `.grok/` (95 files) | Build / preview only |
| Build artefacts | `.vercel/output/**` (36 tracked files), `.grok/preview.log`, `.node_modules.lock` | Committed; should not be |
| Unused deps | 32 of 47 runtime deps have zero imports across `src/`, `server/` and `scripts/` — all 22 Radix packages, `recharts`, `cmdk`, `vaul`, `sonner`, `react-hook-form`, `@hookform/resolvers`, `react-day-picker`, `react-resizable-panels`, `@tanstack/react-table`, `@tanstack/react-query`, `date-fns`, `tw-animate-css` | No |

**Verified good:** the built client bundle contains no `api.x.ai`, no `XAI_API_KEY` and no
`better-auth` code. The Innertube path is tree-shaken out of the client (`youtubei/v1/player`
and `ytInitialPlayerResponse` each appear 0 times in `.vercel/output/static/assets/*.js`); only
the provider-1 URL ships to the browser, which is the documented design.

---

## B. Problem list

Severity: **Blocker** = ships wrong data to the user or cannot deploy · **High** = frequent
wrong or broken behaviour · **Medium** = degraded behaviour or real risk · **Low** / **Nit** =
polish.

---

### 1. Caption extraction reliability

---

#### P01 — Provider 1 responses are parsed regardless of HTTP status

- **Severity**: Blocker
- **Category**: correctness
- **Evidence**: `src/lib/intertext/providers.ts`, `fetchYtaiOnce`:
  ```ts
  if (res.status === 429 || res.status === 403) return blockedError(...);
  const body = await res.text();
  if (!body.trim()) return "network";
  return parseYtaiMarkdown(body, videoId);
  ```
  There is no `res.ok` check. A 404 / 500 / 502 body goes straight to the Markdown parser.
- **User impact** **(reproduced)**: `parseYtaiMarkdown("Not Found", id)` returns a valid
  `RawCapture` whose only segment is `{ start: 0, duration: 4, text: "Not Found" }`. An HTML
  error page becomes a one-paragraph "transcript" reading
  `<!doctype html><html><body><h1>502 Bad Gateway</h1>…`. In `auto` mode this **succeeds**, so
  `runWaterfall` returns `{ ok: true }` and the Innertube fallback is never tried. The user gets
  a bogus transcript, exports it, and it is saved to `localStorage`.
- **Root cause**: success is defined as "the parser did not return an error object", and the
  parser's own last-resort branch (`chunks.length === 0` → push the whole body as one chunk)
  guarantees it never returns an error for arbitrary prose.
- **Recommended fix**: gate on `res.ok` first — `blockedError` for 403/429, `"network"` for any
  other non-2xx. Also reject unexpected content types.
- **Risk / regression**: none; provider 1 returns 200 for real transcripts.
- **Out of scope?** No.

#### P02 — `parseYtaiMarkdown` accepts arbitrary prose as a transcript

- **Severity**: High
- **Category**: correctness
- **Evidence**: `providers.ts`, `parseYtaiMarkdown`, the `chunks.length === 0` branch:
  ```ts
  if (!fallback) return noCaptionsError();
  chunks.push({ start: 0, text: fallback });
  ```
- **User impact**: even with P01 fixed, any 200 response whose shape changes — a provider
  redesign, a captcha interstitial, a rate-limit page served as 200 — becomes a single giant
  untimed paragraph presented as the transcript. All timestamps are `0`, so SRT export is
  meaningless.
- **Root cause**: the "no timestamps found" fallback was written for a plain-text transcript
  variant, but it cannot distinguish that from an unrelated document.
- **Recommended fix**: require structural evidence before accepting the fallback — a
  `# Transcript:` / `## Transcript` heading, a `Language:` line, or at least N timestamp tokens.
  Otherwise return `noCaptionsError()`.
- **Risk / regression**: could reject a legitimate timestamp-free response; mitigate by keeping
  the fallback whenever a `Language:` / `# Transcript:` header was matched.
- **Out of scope?** No.

#### P03 — An unlabelled (`und`) capture short-circuits the waterfall in Auto

- **Severity**: High
- **Category**: reliability
- **Evidence**: `providers.ts`. `providerYtai`'s auto branch returns `fallback` whenever it is
  not an error, and `runWaterfall` returns `{ ok: true }` for any non-error first result. The
  language check (`langMatches(first.language, lang)`) only runs when `lang !== "auto"`.
- **User impact**: in Auto — the default — a degenerate capture (language `und`, one segment) is
  treated as a successful extraction, and the Innertube provider, which would have produced a
  real caption track, is never called.
- **Root cause**: no minimum-quality gate between "parsed without error" and "this is a
  transcript".
- **Recommended fix**: in `runWaterfall`, accept provider 1's result only when it clears a floor
  (`segments.length >= 3` **or** a recognised `language`); otherwise fall through to Innertube
  and prefer whichever produced more segments.
- **Risk / regression**: a genuinely very short video (a 5-second Short) could be pushed to
  provider 2 unnecessarily — acceptable, since provider 2 would also succeed.
- **Out of scope?** No.

#### P04 — Age-restricted / members-only videos are reported as "no public captions"

- **Severity**: Medium
- **Category**: UX
- **Evidence**: `providers.ts`, `runWaterfall`:
  ```ts
  if (second.code === "no_captions" || second.code === "language_missing") {
    return { ok: false, error: second };
  }
  return { ok: false, error: first };
  ```
- **User impact**: when provider 1 correctly classifies the video as `age_restricted` or
  `members_only` and Innertube — unsigned, so it cannot see the tracks — reports `no_captions`,
  the specific diagnosis is discarded. The user is told "No public captions were found" and
  pointed at yt-dlp, which will fail for the same reason.
- **Root cause**: "prefer the more specific of the two failures" assumes `no_captions` is more
  specific than a playability classification; the opposite is true.
- **Recommended fix**: rank error codes explicitly —
  `age_restricted` / `members_only` / `unavailable` > `language_missing` > `no_captions` >
  `provider_blocked` > `network` — and return the highest-ranked of the two.
- **Risk / regression**: a false `age_restricted` from provider 1 would now win; low, since that
  classification requires an explicit reason string.
- **Out of scope?** No.

#### P05 — The waterfall's worst-case latency exceeds the deployed function limit

- **Severity**: High
- **Category**: deploy
- **Evidence**: `providers.ts` timeouts — provider 1 up to 4 × 14s (see P06), `loadPlayer`
  3 × 14s, timedtext 16s. Worst case for `extractTranscript` is roughly **114s**.
  `summarizeTranscript` can issue up to 5 chunk calls plus 2 final calls, each at
  `AbortSignal.timeout(70_000)`. `.vercel/output/functions/__server.func/.vc-config.json`
  declares no `maxDuration`, so Vercel's default applies (10s Hobby / 15s Pro).
- **User impact**: on the deployed app a slow-but-recoverable extraction is killed by the
  platform; `client-extract.ts` catches the resulting error and reports a generic `network`
  failure with no hint that a timeout occurred. Long videos hit the same wall on summarize.
- **Root cause**: timeouts were tuned for the local dev server, not the serverless target.
- **Recommended fix**: (a) add a whole-waterfall deadline (~25s) using one shared
  `AbortSignal`, and drop the per-call budget to ~6–8s; (b) declare `maxDuration` on the
  function; (c) move summarize into its own request so a slow model call cannot kill extraction.
- **Risk / regression**: shorter timeouts increase spurious `network` errors on slow networks —
  pair this with a visible retry (P36).
- **Out of scope?** No.

#### P06 — Auto mode issues up to four provider-1 requests, one of them a duplicate

- **Severity**: Medium
- **Category**: performance
- **Evidence**: `providers.ts`, `providerYtai`. The `lang === "auto"` block calls
  `fetchYtaiOnce(videoId, undefined)`; if that returns a *soft* error, control falls through to
  the loop below, whose `langsToTry` is `["ko", "en", undefined]` with a **fresh** `seen` set —
  so the unspecified-language request is made a second time.
- **User impact**: up to 4 × 14s of latency before provider 2 is even tried, and 4× the load on
  a provider the README calls "fair-use, not a bulk scraping API".
- **Root cause**: the auto pre-flight and the generic loop were written independently and share
  no request cache.
- **Recommended fix**: hoist `seen` (or a small `Map<string, result>` memo) above both blocks so
  each `(videoId, lang)` pair is fetched at most once per extraction.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P07 — Innertube client names and versions are hardcoded and already stale

- **Severity**: Medium
- **Category**: reliability
- **Evidence**: `providers.ts`, `loadPlayer`:
  `postInnertube(videoId, "ANDROID_VR", "1.57.29", { androidSdkVersion: 32 })` then
  `postInnertube(videoId, "WEB", "2.20240101.00.00")`.
- **User impact**: when YouTube retires a client version, provider 2 silently returns a player
  with no `captionTracks`, `loadPlayer` falls through to the watch-page scrape, and if that is
  bot-checked the user sees `provider_blocked` with no indication that the app's own constants
  are the cause.
- **Root cause**: no version indirection, and no signal distinguishing "client rejected" from
  "video has no captions".
- **Recommended fix**: move the client matrix into one exported constant with a comment naming
  the date it was last verified, and record which client produced the player in
  `ExtractError.details` so failures are diagnosable.
- **Risk / regression**: none (constants only).
- **Out of scope?** No — though keeping versions current is ongoing maintenance, not a one-time
  fix.

#### P08 — Every non-OK `timedtext` status is reported as "blocked"

- **Severity**: Medium
- **Category**: UX
- **Evidence**: `providers.ts`, `providerInnertube`:
  `if (!capRes.ok) return blockedError(\`timedtext HTTP ${capRes.status}\`);`
- **User impact**: a 404 — an expired `baseUrl`, which carries a signed, time-limited token —
  tells the user "Caption providers were blocked or rate-limited. Wait a moment and retry."
  Retrying will not help, because the player response has to be re-fetched.
- **Root cause**: one error constructor covers all statuses.
- **Recommended fix**: map 403/429 → `provider_blocked`, 404/410 → re-fetch the player once then
  `no_captions`, 5xx → `network`.
- **Risk / regression**: the retry adds one request on an uncommon path.
- **Out of scope?** No.

#### P09 — No size limit on any provider response body

- **Severity**: Medium
- **Category**: security
- **Evidence**: `providers.ts` — `await res.text()` in `fetchYtaiOnce`, `playerFromWatchPage` and
  the timedtext read. `playerFromWatchPage` then runs a character-by-character brace scan
  (`extractJsonAfter`) across the whole document.
- **User impact**: a YouTube watch page is routinely 1–3 MB; a hostile or malfunctioning
  provider-1 response is unbounded. On a serverless function that is memory pressure plus, via
  the linear brace scan, CPU burn — a cheap way for one request to consume the whole function.
- **Root cause**: `fetch` has a timeout but no byte budget.
- **Recommended fix**: read through `res.body` with a running byte counter (cap ~4 MB for the
  watch page, ~2 MB for transcripts) and abort past the cap; bound `extractJsonAfter`'s scan
  length.
- **Risk / regression**: a legitimately huge watch page would be rejected; 4 MB is generous.
- **Out of scope?** No.

#### P10 — `captionTracks[].baseUrl` is fetched with no host allowlist

- **Severity**: Low
- **Category**: security
- **Evidence**: `providers.ts`, `providerInnertube`:
  `const timedtextUrl = withJson3(chosen.baseUrl);` then `fetchOk(timedtextUrl, …)`.
- **User impact**: none today — the URL comes from YouTube's own player response, and the only
  user-controlled input (`videoId`) is validated by `isVideoId` in `extract.ts`, so there is no
  user-driven SSRF. But the server will follow whatever host that field names.
- **Root cause**: the upstream response is trusted transitively.
- **Recommended fix**: assert `new URL(baseUrl).hostname` ends with `.youtube.com` or
  `.googlevideo.com` before fetching; refuse otherwise.
- **Risk / regression**: none.
- **Out of scope?** No — cheap defence in depth.

#### P11 — `parseAvailableLangs` depends on an undocumented `Name (code)` format

- **Severity**: Low
- **Category**: reliability
- **Evidence**: `providers.ts`: `/([a-zA-Z][\w-]*)\s*\(([\w-]+)\)(\s*\[auto\])?/g` applied to the
  `Other available languages:` line.
- **User impact**: if provider 1 changes that line's format, `availableLanguages` collapses to
  just the detected track. `languageMissing` then offers a fallback the user already has, and the
  "Available: …" list disappears from the error message.
- **Root cause**: screen-scraping a human-readable line with no schema.
- **Recommended fix**: keep the regex but add a unit test pinning the current format, and treat
  an empty parse as "unknown" rather than "none" in the error copy.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P12 — The final provider-1 chunk gets a synthetic 4-second duration

- **Severity**: Low
- **Category**: correctness
- **Evidence**: `providers.ts`, `parseYtaiMarkdown`:
  `const duration = next ? Math.max(0.4, next.start - chunk.start) : Math.max(0.4, 4);`
- **User impact**: the last SRT cue ends at an arbitrary time, and `durationSec` (when the
  `Duration:` header is absent) is short by however long the closing remark actually ran.
- **Root cause**: provider 1's Markdown supplies start times only.
- **Recommended fix**: when `durationSec` is known, clamp the last cue to `durationSec - start`;
  otherwise use the median inter-chunk gap instead of the constant 4.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P13 — The language-fallback CTA collapses every non-ko/en track to "Auto"

- **Severity**: Medium
- **Category**: UX
- **Evidence**: `src/components/intertext/workspace.tsx`, the `language_missing` branch:
  ```ts
  const next = error.fallbackLang?.toLowerCase().startsWith("ko") ? "ko"
    : error.fallbackLang?.toLowerCase().startsWith("en") ? "en" : "auto";
  ```
  and `languageName(code)` returns the raw code for anything else.
- **User impact**: for a Japanese-only video the button reads "Extract ja instead" but sets the
  mode to **Auto**, which re-runs the same ko → en → first-track preference — it does not request
  `ja`. If provider 1 then returns a different track the user gets something they did not ask
  for; if the Auto path fails, the same error reappears and the CTA loops.
- **Root cause**: `LangMode` is a closed union of `auto | ko | en`, so an arbitrary
  `fallbackLang` has nowhere to go.
- **Recommended fix**: widen the extract path to accept an explicit language code
  (`LangMode | { code: string }`); at minimum relabel to "Extract the available track (ja)" so
  the copy matches what Auto will actually do.
- **Risk / regression**: widening `LangMode` touches `extract.ts`'s validator, `storage.ts`'s
  `requestedLang`, and the segmented control — do it deliberately.
- **Out of scope?** No.

#### P14 — URL parsing covers the documented forms, but tests miss two of them

- **Severity**: Nit
- **Category**: tests
- **Evidence**: `parse-url.ts` `YT_HOSTS` includes `music.youtube.com`; `fromPathKind` handles
  `shorts | live | embed | v | e | watch`; `parseYouTubeInput` unwraps the `?u=` attribution
  param. `parse-url.test.ts` exercises watch / youtu.be / shorts / live / embed / nocookie but
  **not** `music.youtube.com/watch?v=` and **not** the `?u=` attribution path.
- **User impact**: none observed — the code handles both. Untested branches regress silently.
- **Root cause**: the test was written from the README's headline list.
- **Recommended fix**: add both cases to `parse-url.test.ts`.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P15 — `parseYouTubeInput` recurses on `?u=` with no depth guard

- **Severity**: Low
- **Category**: reliability
- **Evidence**: `parse-url.ts` — the attribution branch calls `parseYouTubeInput(innerPath)`
  recursively with no depth counter.
- **User impact**: each level consumes input, so recursion is bounded by input length — but a
  large pasted string of nested `?u=` values can reach a deep stack in the browser.
- **Root cause**: no explicit bound.
- **Recommended fix**: add a `depth = 0` parameter and bail at 3; cap accepted input length (a
  YouTube URL is never over 2 KB).
- **Risk / regression**: none.
- **Out of scope?** No.

#### P16 — Any 11-character token is accepted as a video ID before URL parsing

- **Severity**: Low
- **Category**: UX
- **Evidence**: `parse-url.ts` — `if (isVideoId(originalInput)) return success(...)` runs before
  the `new URL(...)` attempt, and `VIDEO_ID_RE` is `/^[a-zA-Z0-9_-]{11}$/`.
- **User impact**: pasting an 11-character word (`hello_world`, `interviewX`) skips the "that
  does not look like a YouTube URL" message and instead produces a full provider round-trip
  ending in "No public captions were found for this video" — a misleading diagnosis for a typo.
- **Root cause**: YouTube IDs are genuinely indistinguishable from arbitrary 11-char tokens.
- **Recommended fix**: keep accepting them (it is the documented input), but when a raw-ID
  extraction fails, add "Check that this is a video ID and not a typo" to the `no_captions` copy.
- **Risk / regression**: none.
- **Out of scope?** No.

---

### 2. Transcript quality and speaker attribution

---

#### P17 — Without `XAI_API_KEY`, every paragraph is labelled with the summary's heading

- **Severity**: Blocker
- **Category**: correctness
- **Evidence** **(reproduced)**: a chain across three files.
  1. `summarize.ts` `fallbackSummary` returns `"Interview key points:\n- …"` — its `kindLabel`
     heading — whenever no API key is configured.
  2. `summarize.ts` `fail()` returns `speakers: speakersFromSummary(summary)`.
  3. `speakers.ts` `speakersFromSummary` matches `^\s*[-*•]?\s*(Name)\s*[:：]`, so the heading
     `Interview key points:` matches — at 20 chars and 3 words, `isFalseSpeaker` lets it through.
  4. `workspace.tsx` `finishJob` calls
     `labelInterviewByRole(paragraphs, ["Interview key points"])`; with `names.length === 1`
     **every** paragraph gets `speaker: "Interview key points"`.

  Probe output:
  ```
  NAMES:   ["Interview key points"]
  LABELED: ["Interview key points","Interview key points","Interview key points"]
  ```
- **User impact**: this is the **default configuration** — `summaryKind` defaults to
  `"interview"` in `workspace.tsx`, and the README documents the no-model fallback as a supported
  path. Every transcript paragraph is prefixed `Interview key points:` on screen, that prefix is
  written into the TXT, SRT, Markdown and JSON exports, and the job is persisted to
  `localStorage` in that state.
- **Root cause**: two separate defects compounding — a summary heading that ends in a colon
  (P19's regex) and a single-name interview path that labels unconditionally (P18).
- **Recommended fix**: smallest change that removes the user-visible symptom — drop the trailing
  colon from `fallbackSummary`'s heading (emit it as a `## ` heading instead), **and** have
  `summarizeTranscript`'s `fail()` return `speakers: []` rather than mining its own generated
  text. Fix P18 and P19 as well.
- **Risk / regression**: `summarize.test.ts` asserts on `fallbackSummary`'s bullets, not its
  heading, so the heading change is safe. Returning `speakers: []` means the interview path
  produces no labels without a model — which is the correct, documented behaviour ("it does not
  invent speaker names").
- **Out of scope?** No.

#### P18 — `labelInterviewByRole` invents host/guest attribution for every paragraph

- **Severity**: High
- **Category**: correctness
- **Evidence** **(reproduced)**: `speakers.ts`, `labelInterviewByRole`. With two names it assigns
  a speaker to **every** paragraph from text heuristics alone:
  ```ts
  if (looksLikeQuestion(p.text)) speaker = host;
  else if (long && last === host) speaker = guest;
  else if (brief && last === guest && i > 0) speaker = host;
  ```
  Probe on a **monologue** with `["진행자", "성상현"]`:
  ```
  ["성상현", "진행자", "성상현", "진행자"]
  ```
- **User impact**: a lecture, a solo podcast, or any single-speaker video is rendered as a
  two-person dialogue. `workspace.tsx` defaults `summaryKind` to `"interview"`, so this is the
  default path. The labels reach every export and cannot be turned off from the UI.
- **Root cause**: the function has no evidence gate — it never asks whether the caption track
  actually contains turn markers, and it never abstains.
- **Recommended fix**: run role labelling only when the source carries turn evidence — cleaned
  cues with `turnMark` or a `Name:` prefix, both of which `explodeSpeakerMarks` already computes.
  Otherwise return the paragraphs unlabelled. Optionally surface a "speaker labels are inferred"
  note in the UI when they are.
- **Risk / regression**: `clean.test.ts` "labels host questions and guest answers without adding
  lines" asserts current behaviour on a `>>`-marked fixture, which *does* have turn evidence, so
  it should still pass — verify.
- **Out of scope?** No. This is not the documented "does not invent speaker names" limit: the
  names come from the model, but the *attribution* is fabricated.

#### P19 — `speakersFromSummary` treats any `Word:` bullet prefix as a person

- **Severity**: High
- **Category**: correctness
- **Evidence** **(reproduced)**: `speakers.ts`, `speakersFromSummary`. Input
  `"- 결론: 금리는 내린다.\n- Key point: liquidity matters.\n- Action items: review Q3."`
  returns `["결론", "Key point", "Action items"]`. `isFalseSpeaker`'s blocklist covers
  `summary`, `overview`, `note`, `요약`, `제목` — nothing generic.
- **User impact**: a model summary that uses topic-prefixed bullets — a very common shape,
  especially for `meeting` and `course` — yields fake speaker names. Combined with P18, these
  become the "host" and "guest" of the entire transcript.
- **Root cause**: the regex cannot distinguish `Name:` from `Topic:`, and there is no cross-check
  against the transcript.
- **Recommended fix**: require corroboration — accept a candidate only if it also appears as a
  `Name:` prefix in the cleaned cues, or is returned in the model's explicit `speakers` array.
  Treat `speakersFromSummary` as a last resort, not the default.
- **Risk / regression**: `summarize.test.ts` "falls back to bullet names when JSON speakers are
  missing" asserts `["진행자", "성상현"]` from a bullet summary; it would need the corroboration
  path stubbed, or the fixture extended with matching transcript cues.
- **Out of scope?** No.

#### P20 — The model's `turns` are parsed and then thrown away

- **Severity**: Medium
- **Category**: maintainability
- **Evidence**: `summarize.ts` `parseSummaryPayload` builds a validated `turns: SpeakerTurn[]`,
  but **both** success returns in the handler hardcode `turns: []`:
  ```ts
  return { ok: true, summary: parsed.summary, speakers: parsed.speakers, turns: [], source: "model" };
  ```
  `finalPrompt` never asks for a `turns` field either — it requests
  `{ "summary": "…", "speakers": ["…","…"] }`.
- **User impact**: `workspace.tsx`'s
  `turns.length > 0 ? applySpeakerNames(job.paragraphs, names, turns) : labelInterviewByRole(...)`
  can never take the first branch. The *accurate* per-paragraph attribution path is dead code, so
  the *heuristic* path (P18) always runs — even when a model key is configured.
- **Root cause**: the prompt and the return value were never wired to the parser.
- **Recommended fix**: ask for `turns` in `finalPrompt` (`{"i": <paragraph index>, "speaker": "…"}`)
  and return `parsed.turns` / `again.turns` instead of `[]`.
- **Risk / regression**: turns increase output tokens; `applySpeakerNames` already range-validates
  `t.i`. Combine with P18 so an absent `turns` means "no labels", not "guess".
- **Out of scope?** No.

#### P21 — The no-model summary is always English-framed, even for Korean transcripts

- **Severity**: Medium
- **Category**: i18n
- **Evidence**: `summarize.ts` `fallbackSummary` emits `"Interview key points:"` /
  `"Meeting key points:"` / `"Talk key points:"` regardless of language. `languageHint`, which
  does handle Korean, is used only for model prompts.
- **User impact**: a Korean interview extracted with no API key gets a Korean bullet list under
  an English heading. The README's language policy promises Korean is handled end to end.
- **Root cause**: the fallback predates the language hint.
- **Recommended fix**: pass the transcript language into `fallbackSummary` and pick the heading
  from it (`인터뷰 핵심 요지` / `회의 핵심 요지` / …).
- **Risk / regression**: `summarize.test.ts` does not assert the heading. Note the interaction
  with P17 — fix them together.
- **Out of scope?** No.

#### P22 — `fillSpeakerGaps` back-fills labels onto paragraphs that had no evidence

- **Severity**: Low
- **Category**: correctness
- **Evidence**: `speakers.ts`, `fillSpeakerGaps` runs a forward pass and then a **backward**
  pass, so paragraphs before the first labelled turn inherit that turn's speaker. `clean.ts`
  `cleanTranscript` applies it whenever *any* paragraph has a speaker.
- **User impact**: an intro monologue preceding the first `>>` marker is attributed to whoever
  speaks after it.
- **Root cause**: the backward pass has no distance or pause limit.
- **Recommended fix**: back-fill only across a small gap (under ~2s, and no intervening
  `turnMark`); otherwise leave the paragraph unlabelled.
- **Risk / regression**: more unlabelled paragraphs, which is the safer default.
- **Out of scope?** No.

#### P23 — `dedupeRepeatedPhrases` can delete legitimate repetition

- **Severity**: Low
- **Category**: correctness
- **Evidence**: `clean.ts`: `t.replace(/([가-힣]{2,8})(?:\s*\1){2,}/g, "$1")` and
  `t.replace(/\b([A-Za-z]{3,})\b(?:\s+\1\b){2,}/gi, "$1")`, looped up to 8 times.
- **User impact**: genuine emphatic repetition ("네 네 네", "no no no") collapses to a single
  token, changing what the speaker said. The README promises the cleaner "keeps original
  wording".
- **Root cause**: one rule serves both ASR chip de-duplication and prose cleanup; only the former
  needs it.
- **Recommended fix**: apply the aggressive rules only inside `collapseRollingCaptions`, where
  chips genuinely overlap, and use a conservative variant for paragraph-level text.
- **Risk / regression**: some rolling-caption artefacts would survive into paragraphs.
  `clean.test.ts` "collapses a word repeated three times" pins the current behaviour and would
  need to move to the chip-level function.
- **Out of scope?** No.

---

### 3. Exports

---

#### P24 — Export filenames omit the `_{lang}` suffix the README documents

- **Severity**: Medium
- **Category**: correctness
- **Evidence**: `README.md` states "Filenames: `{sanitizedTitle-or-videoId}_{lang}.{ext}`".
  `export.ts` `exportBasename` returns `sanitizeFilename(job.title, job.videoId)` with no
  language, and `result-pane.tsx` downloads `${base}.txt`. `export.test.ts` actively pins the
  current behaviour: `assert.equal(exportBasename(job).includes("_ko"), false);`
- **User impact**: extracting the same video in Korean and then English writes the same filename
  twice; the browser silently appends " (1)" and the two files are indistinguishable.
- **Root cause**: the README and the test encode opposite intentions; one changed without the
  other.
- **Recommended fix**: pick one and make both agree. Recommend implementing the documented
  behaviour (`${base}_${job.language}.${ext}`) and updating the test, since it solves a real
  collision.
- **Risk / regression**: `export.test.ts` fails until updated — that is the point.
- **Out of scope?** No.

#### P25 — The README's JSON and Markdown schemas do not match the code

- **Severity**: Medium
- **Category**: maintainability
- **Evidence**: README: "JSON | `{ videoId, url, language, sourceType, segments[] }`".
  `export.ts` `buildJson` also emits `title`, `provider`, `summaryKind`, `summary` and a full
  `paragraphs[]` array. README: "Markdown | Title, source URL, language, transcript";
  `buildMarkdown` also emits a `Provider:` line and a `## Summary` section.
- **User impact**: anyone scripting against the documented JSON shape works from a stale
  contract, and `paragraphs[]` — the readable output — is undocumented and easy to miss.
- **Root cause**: exports grew past the README.
- **Recommended fix**: update the README table to the actual shape and mark it as the contract.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P26 — "Copy" copies title + summary + transcript, not the visible transcript

- **Severity**: Medium
- **Category**: UX
- **Evidence**: README: "Copy copies the visible transcript, not JSON." `result-pane.tsx`
  `copyVisible` writes `fullText = composeDocument(job, tsMode)`, which is title + summary +
  transcript. The button is labelled "Copy text".
- **User impact**: a user who has searched and is looking at 3 filtered paragraphs presses Copy
  and receives the entire document including the summary. There is no way to copy only the
  transcript, and no way to copy only what is on screen.
- **Root cause**: `composeDocument` is the export body and was reused for the clipboard.
- **Recommended fix**: at minimum relabel to "Copy document" and update the README. Better: split
  into "Copy transcript" (`visibleTranscript(paragraphs, tsMode)`) and "Copy with summary".
- **Risk / regression**: none.
- **Out of scope?** No.

#### P27 — The Windows BOM checkbox only affects TXT

- **Severity**: Low
- **Category**: UX
- **Evidence**: `result-pane.tsx` `download()` passes `bom` for `txt` and hardcodes `false` for
  `srt`, `md` and `json`. The label reads "Windows-friendly TXT (UTF-8 BOM)".
- **User impact**: the label is honest, but the Windows mojibake problem the checkbox exists to
  solve also hits SRT opened in Notepad and Markdown opened in legacy editors. A Korean SRT is
  exactly the case that breaks.
- **Root cause**: the option was scoped to TXT.
- **Recommended fix**: apply `bom` to SRT and Markdown too — never JSON, where a BOM breaks
  `JSON.parse` — and relabel to "Windows-friendly text files (UTF-8 BOM)".
- **Risk / regression**: some SRT players mishandle a BOM; keep the opt-out and consider
  defaulting it off for SRT specifically.
- **Out of scope?** No.

#### P28 — SRT cues can overlap, and the final cue has an invented end time

- **Severity**: Low
- **Category**: correctness
- **Evidence**: `export.ts` `buildSrt` computes `end = start + Math.max(seg.duration, 0.4)` per
  segment with no clamp against the next segment's start. `clean.ts` `mergeCues` extends
  `prev.duration` to `next.start + next.duration - prev.start`, and `speakers.ts`
  `explodeSpeakerMarks` splits one cue into sub-cues by character ratio — both can produce a cue
  ending after the following cue begins. P12 supplies the last cue's synthetic duration.
- **User impact**: strict SRT consumers reject overlapping cues; players show two subtitles at
  once.
- **Recommended fix**: in `buildSrt`, clamp `end` to `min(start + duration, nextStart - 0.001)`,
  and clamp the final cue to `job.durationSec` when it is known.
- **Risk / regression**: `export.test.ts` pins the first cue's exact timings
  (`00:00:00,000 --> 00:00:04,000`); with a next-start of 4 the clamp yields `00:00:03,999`, so
  that assertion needs updating.
- **Out of scope?** No.

#### P29 — `revokeObjectURL` fires immediately after `click()`

- **Severity**: Low
- **Category**: reliability
- **Evidence**: `export.ts` `downloadUtf8` calls
  `a.click(); a.remove(); URL.revokeObjectURL(href);` synchronously.
- **User impact**: some browsers — notably Safari — have not started reading the blob when the
  URL is revoked, and the download fails silently.
- **Recommended fix**: defer with `setTimeout(() => URL.revokeObjectURL(href), 0)` or longer.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P30 — `sanitizeFilename` does not guard Windows reserved names

- **Severity**: Nit
- **Category**: correctness
- **Evidence**: `export.ts` `sanitizeFilename` strips `<>:"/\|?*` plus control characters and
  trims trailing dots and spaces, but a video titled `CON` or `NUL` still yields `CON.txt`, which
  Windows refuses to create.
- **Recommended fix**: prefix reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
  `LPT1`–`LPT9`) with an underscore.
- **Risk / regression**: none.
- **Out of scope?** No.

---

### 4. State and storage

---

#### P31 — `loadJobs` does not apply `withJobDefaults`, so migrated v1 jobs stay malformed

- **Severity**: Medium
- **Category**: correctness
- **Evidence**: `storage.ts` — `loadJobs` reads `intertext.jobs.v2` **or** the legacy
  `intertext.jobs.v1` key, filters with a shallow `isJob`, and returns. `withJobDefaults` is
  called only in `saveJobs` / `upsertJob`.
- **User impact**: a job written before `summaryKind` / `summary` existed comes back with those
  fields `undefined`. `ResultPane` then renders `summaryKindLabel(undefined)`, so the badge reads
  "General" for an interview, and an `undefined` `job.summary` skips the summary section with no
  explanation. `workspace.tsx` `reopen` papers over one field
  (`next.summaryKind || "interview"`), but the loaded `Job` object itself stays wrong.
- **Root cause**: the v1 → v2 migration reads the old key but never normalises the payload.
- **Recommended fix**: `return parsed.filter(isJob).map(withJobDefaults).slice(0, LIMIT);` and
  write the normalised result back under the v2 key.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P32 — Transcripts persist in `localStorage` with no way to delete them

- **Severity**: Medium
- **Category**: UX / privacy
- **Evidence**: `workspace.tsx` renders the Recent list read-only — each row is a `reopen`
  button; there is no per-row delete and no "Clear history". `storage.ts` only ever writes.
- **User impact**: up to 10 full transcripts, including speaker labels and summaries, sit in the
  browser indefinitely on whatever machine ran the extraction — a shared or borrowed computer
  keeps them. The README leans on "Nothing is stored on a server" as the privacy story but says
  nothing about clearing what *is* stored locally.
- **Root cause**: the feature was built append-only.
- **Recommended fix**: add a per-row remove control and a "Clear recent" action calling
  `saveJobs([])` / `localStorage.removeItem(KEY)`; mention local storage in the footer.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P33 — Concurrent tabs silently clobber each other's history

- **Severity**: Low
- **Category**: correctness
- **Evidence**: `storage.ts` `upsertJob` computes the next list from the **in-memory** `jobs`
  array passed by the caller, not from a fresh read. `workspace.tsx` loads once in a mount
  `useEffect` and never listens for `storage` events.
- **User impact**: with two tabs open, each extracting a video, the second write drops the first
  tab's job.
- **Recommended fix**: re-read inside `upsertJob` before merging, and add a `window` `"storage"`
  listener that refreshes `jobs`.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P34 — `isJob` validation is shallow

- **Severity**: Low
- **Category**: reliability
- **Evidence**: `storage.ts` `isJob` checks only that `videoId` / `url` are strings and
  `segments` / `paragraphs` are arrays. The array *elements* are unvalidated, as are `createdAt`,
  `durationSec` and `language`.
- **User impact**: hand-edited or partially-written storage yields a job whose paragraphs lack
  `text`; `visibleTranscript` / `wordCount` then throw during render, the error boundary
  (`AppErrorComponent`) replaces the page, and the bad entry is never cleared — so every reload
  fails identically.
- **Recommended fix**: validate element shape (`typeof p.text === "string"`, numeric `start` and
  `duration`) and drop entries that fail. There is no XSS risk here — React escapes all caption
  text and nothing uses `dangerouslySetInnerHTML` on job data.
- **Risk / regression**: none.
- **Out of scope?** No.

---

### 5. UI and UX

---

#### P35 — A throw inside `runExtract` leaves the UI spinning forever

- **Severity**: High
- **Category**: reliability
- **Evidence**: `workspace.tsx` `runExtract` wraps its body in `try { … } finally { … }` with
  **no `catch`**, and is invoked as `void runExtract(input, lang, summaryKind)`.
- **User impact**: any unexpected throw — `finishJob` / `applySpeakerNames` on a malformed job,
  `upsertJob` on corrupt storage, a `useServerFn` transport error shape the inner handler does
  not cover — rejects the promise. `status` stays `"extracting"`, the skeleton spins, every
  control stays `disabled`, and the only escape is a page reload. Nothing is shown to the user.
- **Root cause**: `finally` was added for timer cleanup, and the error path was assumed to be
  fully covered by `extractCaptions`'s internal catches.
- **Recommended fix**: add
  `catch (err) { setJob(null); setError({ code: "network", message: "Extraction failed unexpectedly. Try again.", details: String(err) }); setStatus("error"); }`.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P36 — No cancel and no retry

- **Severity**: Medium
- **Category**: UX
- **Evidence**: `workspace.tsx` — the submit button is `disabled={busy}` during extraction and no
  `AbortController` is threaded into `extractCaptions`. The error panel offers a CTA only for
  `language_missing`.
- **User impact**: an extraction that will take ~114s (P05) cannot be stopped, and after a
  `network` or `provider_blocked` failure — the two most transient codes, and the two whose copy
  explicitly tells the user to retry — there is no retry button. The user must re-focus the input
  and resubmit.
- **Recommended fix**: hold an `AbortController` in a ref, pass its signal through
  `extractCaptions` into `fetchOk`, show a Cancel button while busy, and render a "Try again"
  button for `network` and `provider_blocked`.
- **Risk / regression**: threading the signal touches every `fetchOk` call site; combine with the
  P05 deadline work.
- **Out of scope?** No.

#### P37 — `SegmentedControl` claims radio semantics without radio keyboard behaviour

- **Severity**: Medium
- **Category**: a11y
- **Evidence**: `segmented-control.tsx` renders `role="radiogroup"` around `role="radio"` buttons
  with correct `aria-checked`, but every option is independently tabbable and there is no
  `onKeyDown` handling for arrow keys.
- **User impact**: screen-reader and keyboard users get a control announced as a radio group that
  does not respond to arrow keys, and Tab walks through all 5 summary-type options instead of
  moving past the group. This affects all three groups — language, summary type, timestamps.
- **Root cause**: ARIA roles were added without the matching interaction pattern.
- **Recommended fix**: implement roving tabindex (`tabIndex={on ? 0 : -1}`) plus
  Arrow / Home / End handling — or drop to plain `<button aria-pressed>` inside a toolbar, which
  needs no arrow keys.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P38 — `TranscriptView` is quadratic in the number of paragraphs

- **Severity**: Medium
- **Category**: performance
- **Evidence**: `transcript-view.tsx`, inside the render map:
  `const n = paragraphs.indexOf(paragraph) + 1;` — a linear scan per row, computed
  **unconditionally** even though `n` is rendered only when `mode === "srt"`.
- **User impact**: a two-hour interview cleans to well over a thousand paragraphs, so this is
  roughly a million comparisons per render — and the component re-renders on **every keystroke**
  in the search box. Typing in search becomes visibly laggy on long transcripts and on mobile.
- **Root cause**: index recovery after filtering, done by identity search instead of carried
  alongside the value.
- **Recommended fix**: map to `{ paragraph, index }` pairs before filtering, then read
  `item.index`. Also memoise the filtered list with `useMemo` on `[paragraphs, q]`.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P39 — Errors are announced politely and never receive focus

- **Severity**: Low
- **Category**: a11y
- **Evidence**: `workspace.tsx` — the status paragraph is `role="status" aria-live="polite"`,
  while the error panel below it is a plain `<div>` with no `role="alert"`, no `tabIndex` and no
  focus call.
- **User impact**: a screen-reader user hears the short status label ("Error · no public
  captions") but not the actionable message or the fallback CTA, and focus stays on the submit
  button far from the new content.
- **Recommended fix**: add `role="alert"` to the error panel and move focus to it, or to its CTA,
  when `status` becomes `"error"`.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P40 — The match count and the filtered transcript disagree

- **Severity**: Low
- **Category**: UX
- **Evidence**: `result-pane.tsx` computes `hits = countMatches(fullText, query)` over
  title + summary + transcript, while `TranscriptView` filters only `paragraphs`.
- **User impact**: searching for a word that appears only in the summary reports "3 matches" and
  then shows "No paragraphs match" — the two statements contradict each other on screen.
- **Recommended fix**: report the counts separately ("2 in summary · 1 in transcript"), or count
  only what the list can actually show.
- **Risk / regression**: none.
- **Out of scope?** No.

#### P41 — The language-fallback CTA re-reads the URL input, which may no longer match

- **Severity**: Low
- **Category**: UX
- **Evidence**: `workspace.tsx` — `void runExtract(input, next, summaryKind)` inside the
  `language_missing` branch reads the live `input` state.
- **User impact**: the user gets a `language_missing` error, edits the URL box (or clicks a
  Recent job, which calls `setInput(next.url)`), then presses "Extract Korean instead" — and
  extracts a *different* video under an error message about the first one.
- **Recommended fix**: capture the `videoId` that produced the error in state and re-run against
  that, not against the live input.
- **Risk / regression**: none.
- **Out of scope?** No.

---

### 6. Security and abuse

---

#### P42 — `summarizeTranscript` is an unauthenticated, unmetered model-spend endpoint

- **Severity**: High
- **Category**: security
- **Evidence**: `summarize.ts` — `createServerFn({ method: "POST" })` with a validator that only
  shape-checks and truncates (800 paragraphs × 800 chars, roughly **640 KB** of caller-supplied
  text). No auth, no rate limit, no per-IP budget. The handler can then issue up to 5 chunk calls
  plus 2 final calls to `https://api.x.ai/v1/chat/completions` on the deployer's `XAI_API_KEY`.
- **User impact**: the deployed app exposes a public endpoint that turns arbitrary POSTed text
  into paid model calls. `paragraphs` need not come from a real transcript — anyone can use it as
  a free summarization API against the owner's key until the quota is exhausted, at which point
  legitimate users silently drop to the fallback summary (and into P17).
- **Root cause**: server functions in this template are public by default, and the product needs
  no accounts, so nothing gates the call.
- **Recommended fix**: minimum viable — require the caller to supply a `videoId` and re-derive
  the paragraphs server-side, or verify a short-lived token minted by `extractTranscript`; add a
  per-IP token bucket; cap the paragraph budget far below 640 KB.
- **Risk / regression**: re-deriving paragraphs server-side means a second extraction; a signed
  token over the extraction result is cheaper.
- **Out of scope?** No — this is a deployment-blocking cost exposure, not a documented limit.

#### P43 — `extractTranscript` is an unauthenticated outbound-fetch proxy

- **Severity**: Medium
- **Category**: security
- **Evidence**: `extract.ts` validates `isVideoId(input.videoId)` and the language — good, and
  the reason there is **no user-driven SSRF** (P10 notwithstanding). But there is no rate limit,
  and one request can trigger up to 7 upstream fetches (P06 plus `loadPlayer`).
- **User impact**: an attacker can use the deployed app as an anonymising relay to hammer
  youtube-transcript.ai and YouTube from the app's server IP. That IP then gets rate-limited or
  blocked, and every real user sees `provider_blocked`. This directly undermines the README's
  "fair-use, not a bulk scraping API" commitment.
- **Root cause**: no request budget.
- **Recommended fix**: a per-IP token bucket (e.g. 10/min) in front of the server function, plus
  a short in-memory cache keyed by `videoId:lang` so repeat requests do not re-fetch.
- **Risk / regression**: a shared-NAT office could hit the limit; tune the bucket.
- **Out of scope?** No.

#### P44 — Confirmed clean: no secret leakage, no XSS vector

- **Severity**: — (verification note, not a defect)
- **Evidence**: `grep` over `.vercel/output/static/assets/*.js` finds 0 occurrences of
  `api.x.ai`, `XAI_API_KEY`, `better-auth`, `youtubei/v1/player` and `ytInitialPlayerResponse`.
  Only the provider-1 URL ships to the browser, as designed. No product code passes caption data
  to `dangerouslySetInnerHTML` — the single use, in `__root.tsx`, injects the static
  `THEME_BOOT_SCRIPT` constant. `HighlightedText` builds React elements, so caption text is
  escaped. `JSON.parse` results are never spread into object prototypes; no prototype-pollution
  path was found.
- **Recommended action**: add a regression test asserting the client bundle contains no
  `api.x.ai`, so a future refactor cannot leak the key path into the browser.

---

### 7. Template and repository hygiene

---

#### P45 — `.vercel/output/**` is committed, and every build dirties the working tree

- **Severity**: High
- **Category**: maintainability
- **Evidence**: 36 tracked files under `.vercel/output/`; `.gitignore` contains only
  `node_modules/`, `.project_id`, `.github_repo`, `.env`, `.env.*`. Running `npm run build`
  during this audit produced:
  ```
   M .vercel/output/functions/__server.func/_ssr/ssr.mjs
   D .vercel/output/functions/__server.func/_tanstack-start-manifest_v-BWsFLYCH.mjs
   M .vercel/output/functions/__server.func/index.mjs
   M .vercel/output/nitro.json
  ?? .vercel/output/functions/__server.func/_tanstack-start-manifest_v-_nwhv88K.mjs
  ```
  (reverted after the audit run).
- **User impact**: developer-facing. Every build creates content-hash churn and phantom
  deletions, so real diffs are buried — and a stale committed bundle can be deployed instead of
  a fresh build.
- **Recommended fix**: add `.vercel/` to `.gitignore` and `git rm -r --cached .vercel`.
- **Risk / regression**: if any deploy path consumes the committed prebuilt output rather than
  running `npm run build`, removing it breaks that path — confirm the deploy contract first.
- **Out of scope?** No, but confirm the deploy contract before removing.

#### P46 — `package-lock.json` is out of sync with the dependency tree

- **Severity**: Medium
- **Category**: deploy
- **Evidence**: a plain `npm install` against the committed lockfile rewrote it — `+95 / -16`
  lines, adding missing nested entries (`@eslint/eslintrc/node_modules/ajv`,
  `json-schema-traverse`, and others).
- **User impact**: `npm ci`, which refuses to reconcile, is the usual CI and deploy install
  command and is at risk of failing. Builds are not reproducible from the committed lockfile.
- **Root cause**: the lockfile was committed from an environment that pruned or only partially
  resolved the tree.
- **Recommended fix**: regenerate with a clean `npm install`, commit the result, and verify with
  `npm ci` in a scratch clone.
- **Risk / regression**: version drift on transitive deps — review the regenerated diff.
- **Out of scope?** No.

#### P47 — 6 tests fail at baseline in `scripts/grok-pwa-plugin.test.mjs`

- **Severity**: Medium
- **Category**: tests
- **Evidence**: `npm test` reports `# pass 189 # fail 6`. All six are in the template's PWA
  plugin suite — for example, test 89 expects `property="og:title" content="Hello World"` but the
  injector emits `content="INTERTEXT"`. Failing: 89, 101, 107, 109, 110, 113.
- **Root cause**: `src/lib/og/site.json` was given `"title": "INTERTEXT"`, and
  `grok-pwa-shared.mjs` correctly prefers `site.json` over the per-document title. The tests
  predate `site.json` and assume a document-title fallback.
- **User impact**: developer-facing — `npm test` is red at baseline, so a real regression is
  indistinguishable from the known noise. **No product behaviour is wrong**: the deployed
  `og:title` should be `INTERTEXT`.
- **Recommended fix**: update the six tests to build their fixtures with an explicitly absent
  `site.json`, or to assert the `site.json`-wins behaviour, so the suite goes green.
- **Risk / regression**: none — test-only.
- **Out of scope?** Template scaffolding, but it blocks using `npm test` as a gate, so fix it.

#### P48 — 4 lint errors, 3 of them in product code

- **Severity**: Medium
- **Category**: maintainability
- **Evidence**: `npm run lint`:
  ```
  src/lib/app-data/client.server.ts   281:13  error  Empty block statement                     no-empty
  src/lib/intertext/clean.ts           48:19  error  Unnecessary escape character: \[           no-useless-escape
  src/lib/intertext/export.ts           7:14  error  Unexpected control character(s) in regex   no-control-regex
  src/lib/intertext/summarize.ts       56:19  error  Unnecessary escape character: \[           no-useless-escape
  ```
  plus 2 warnings.
- **User impact**: developer-facing; `npm run lint` cannot be used as a gate.
- **Recommended fix**: `clean.ts:48` and `summarize.ts:56` — the offender is the `[\[(]`
  alternation in the noise-token stripper; rewrite as `[[(]`. `export.ts:7` — the control-character
  range is **intentional** (stripping C0 characters from filenames is correct); add a scoped
  `// eslint-disable-next-line no-control-regex` with a comment explaining why.
  `client.server.ts:281` is dead template code (see P49).
- **Risk / regression**: verify the regex edits against `clean.test.ts` — these strip noise
  tokens, and a wrong edit changes cleaning output.
- **Out of scope?** No.

#### P49 — Auth, database, app-data and multiplayer layers ship in a localStorage-only product

- **Severity**: Medium
- **Category**: maintainability
- **Evidence**: `src/lib/auth/` (19 files), `src/lib/app-data/` (10 files),
  `src/lib/multiplayer/` (2 files), `src/lib/db.ts` and `migrations/auth/0001_auth.sql` — none
  are imported by `src/routes/`, `src/components/` or `src/lib/intertext/`, except the
  passthrough `<AuthProvider>` in `__root.tsx`. `package.json` carries `better-auth`,
  `@electric-sql/pglite`, `kysely`, `pg` and `jose`, plus 32 unused UI dependencies.
  `AGENTS.md` §0.5: "auth and database — both are OFF by default."
- **User impact**: developer-facing. Install time, `tsc` surface and lint surface all carry code
  the product cannot reach, and `npm test` runs `app-data` / `auth` suites that test nothing
  shipped. It also makes security review harder — every audit must re-establish that the auth
  endpoints are genuinely unreachable.
- **Root cause**: Grok template scaffolding was never pruned after `VITE_AUTH_ENABLED=false` and
  `deploy.database=false` were set.
- **Recommended fix**: staged. (1) Drop the 32 unused UI dependencies and `migrations/auth/`.
  (2) Remove `src/lib/multiplayer/`. (3) Remove `src/lib/auth/`, `src/lib/app-data/` and
  `src/lib/db.ts` with their dependencies, replacing `<AuthProvider>` with nothing. Re-run
  `npm run check:auth` and `npm run build` after each stage.
- **Risk / regression**: the template's own scripts (`check-auth-invariant.mjs`,
  `browser-smoke.mjs`, the migration plumbing in `vite.config.ts`) reference these paths and need
  updating in lockstep. Do it in its own commit, not mixed with product fixes.
- **Out of scope?** No, but explicitly **separate** from the correctness work.

#### P50 — Stray artefacts and a placeholder package name are committed

- **Severity**: Low
- **Category**: maintainability
- **Evidence**: tracked `.grok/preview.log` (2,890 bytes of a preview-server run),
  `.node_modules.lock` (0 bytes), and `package.json` `"name": "app-builder-workspace"`.
- **User impact**: developer-facing noise; the package name misidentifies the project everywhere
  npm surfaces it.
- **Recommended fix**: `git rm --cached .grok/preview.log .node_modules.lock`, add both to
  `.gitignore`, and rename the package to `intertext`.
- **Risk / regression**: confirm no script keys off `.node_modules.lock` before removing it.
- **Out of scope?** No.

#### P51 — The riskiest modules have no test coverage

- **Severity**: Medium
- **Category**: tests
- **Evidence**: tests exist for `parse-url`, `clean`, `export` and `summarize`. There are **none**
  for `providers.ts` (748 lines — the whole waterfall, `parseYtaiMarkdown`, `parseJson3`,
  `parseTimedtextXml`, `classifyPlayability`, the error ranking), `storage.ts`, or
  `client-extract.ts`.
- **User impact**: every Blocker and High finding in section 1 (P01, P02, P03, P04) lives in
  `providers.ts`, and none would have been caught by the suite.
- **Recommended fix**: add table-driven tests over fixture strings — no network required.
  `parseYtaiMarkdown` (valid transcript, "transcript unavailable" for each reason, a 404 body, an
  HTML error page); `parseJson3` (overlapping chips, newline-only segs, missing `dDurationMs`);
  `parseTimedtextXml` (entities, `<s>` spans); `classifyPlayability` (each code); `runWaterfall`
  error ranking with an injected fetch; and a `storage` round-trip plus quota fallback.
- **Risk / regression**: none.
- **Out of scope?** No — this is the highest-leverage item after the Blockers.

#### P52 — README drift beyond the export table

- **Severity**: Low
- **Category**: maintainability
- **Evidence**: aggregates P24 (filename suffix), P25 (JSON / Markdown schema) and P26 (Copy
  behaviour). In addition, the README never mentions that the summary depends on `XAI_API_KEY`,
  nor the summary-type selector (General / Meeting / Course / Interview / Podcast) that is the
  second most prominent control in the UI.
- **Recommended fix**: one README pass after the code fixes land, so the document describes
  shipped behaviour.
- **Risk / regression**: none.
- **Out of scope?** No.

---

### 8. Build and runtime

---

#### P53 — `startup.sh` hardcodes `/workspace` and the preview port

- **Severity**: Low
- **Category**: deploy
- **Evidence**: `startup.sh` runs `cd /workspace`, probes `http://127.0.0.1:8080/`, and writes to
  `/tmp/app-startup.log`. `vite.config.ts` pins 8080 (dev) and 8081 (preview) with
  `strictPort: true`.
- **User impact**: the script only works inside the Grok sandbox — it fails immediately in this
  checkout (`/workspace` does not exist) and in any CI or local clone.
- **Root cause**: platform scaffolding, correct for its original host.
- **Recommended fix**: use `cd "$(dirname "$0")"` instead of the absolute path, and read the port
  from `${PORT:-8080}`. The `vite.config.ts` comment states host/port is a live-preview contract,
  so leave that alone unless the app is moving off the platform.
- **Risk / regression**: changing the dev port would break the Grok live preview.
- **Out of scope?** Partly — the port pinning is a documented platform contract; only the
  `cd /workspace` line is worth fixing.

---

## C. Enhancements (documented limits — mitigations, not bugs)

These are the README's stated limits. None is counted as a defect; each entry is an optional
improvement to the experience *around* the limit.

| # | Documented limit | Suggested mitigation |
| --- | --- | --- |
| E1 | No private / members-only / many age-restricted videos | Fix P04 so the error names the actual reason and says what would work ("open on YouTube while signed in → More → Show transcript"). The copy already exists in `classifyPlayability`; P04 is what discards it. |
| E2 | No audio download, no Whisper | On `no_captions`, state plainly that the video has no caption track *at all* — as opposed to none in the requested language — and that INTERTEXT cannot transcribe audio. Both cases currently share one message. |
| E3 | No speaker-name invention | Honour this properly: P17 / P18 / P19 currently fabricate attribution, so the mitigation *is* the fix. Then, when labels are inferred rather than read from the track, mark them as inferred in the UI and in exports. |
| E4 | Provider 1 is fair-use, caches ~24h | Fix P06 (4 requests → 1) and add the P43 result cache. Optionally surface "cached by provider" so a stale transcript is explicable. |
| E5 | Do not scrape YouTube at bulk scale | The P43 rate limit is the enforcement mechanism. Without it, the deployed app is a bulk-scraping proxy regardless of intent. |
| E6 | Live streams often have no stable transcript | `classifyPlayability` does not check `videoDetails.isLive` / `isLiveContent`. Detect it and say "this is live — the transcript appears once the replay is published" instead of `no_captions`. |
| E7 | Only ko / en are first-class | P13's fix — an explicit language code threaded through the extract path — would let the fallback CTA actually extract the track it names, in any language. |

---

## D. Summary by severity

| Severity | IDs | Count |
| --- | --- | --- |
| Blocker | P01, P17 | 2 |
| High | P02, P03, P05, P18, P19, P35, P42, P45 | 8 |
| Medium | P04, P06, P07, P08, P09, P13, P20, P21, P24, P25, P26, P31, P32, P36, P37, P38, P43, P46, P47, P48, P49, P51 | 22 |
| Low | P10, P11, P12, P15, P16, P22, P23, P27, P28, P29, P33, P34, P39, P40, P41, P50, P52, P53 | 18 |
| Nit | P14, P30 | 2 |

**Suggested order of work.** P17 + P19 + P18 as one coherent change (stop fabricating speaker
attribution) → P01 + P02 + P03 (stop shipping non-transcripts) → P35 (stuck spinner) → P51
(tests for `providers.ts`, so the above stay fixed) → P42 + P43 (deployment cost and abuse) →
P05 (serverless timeouts) → P47 + P48 + P46 (make the gates green) → everything else. P49
(template pruning) should be its own commit, isolated from product changes.

---

## E. Phase 1 exit criteria — verification runs

Run on Node v22.22.2 / npm 10.9.7 after `npm install` (`node_modules/` was absent in the fresh
clone; the install rewrote `package-lock.json` — see P46 — and that change was reverted).

### `npm run typecheck` — PASS

```
> tsc --noEmit
(no output, exit 0)
```

### `npm test` — 6 pre-existing failures

```
# tests 195
# pass 189
# fail 6
# duration_ms 1033.5
```

Failing, all in `scripts/grok-pwa-plugin.test.mjs`, all template scaffolding — see P47:

| # | Test |
| --- | --- |
| 89 | platform chrome overwrites share-card metas and always sets og:title |
| 101 | published grok.me slug is still a title fallback |
| 107 | document title entities are not double-escaped on og:title |
| 109 | injects into documents with no head element |
| 110 | streaming injector matches `</HEAD>` case-insensitively |
| 113 | uses the app name in the injected title tag |

All four `src/lib/intertext/*.test.ts` suites pass.

### `npm run lint` — 4 errors, 2 warnings

```
src/components/intertext/transcript-view.tsx   8:17  warning  Fast refresh only works when a file only exports components  react-refresh/only-export-components
src/lib/app-data/client.server.ts            281:13  error    Empty block statement                                        no-empty
src/lib/auth/use-current-user.ts              59:3   warning  Unused eslint-disable directive
src/lib/intertext/clean.ts                    48:19  error    Unnecessary escape character: \[                             no-useless-escape
src/lib/intertext/export.ts                    7:14  error    Unexpected control character(s) in regular expression        no-control-regex
src/lib/intertext/summarize.ts                56:19  error    Unnecessary escape character: \[                             no-useless-escape

✖ 6 problems (4 errors, 2 warnings)
```

### `npm run build` — PASS

```
✓ 1879 modules transformed.
✓ built in 596ms
i Generated .vercel/output/nitro.json
[nitro] √ You can preview this build using npx vite preview
> db:migrate
[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).
```

The build succeeds but modifies tracked files under `.vercel/output/` (see P45); the working tree
was restored with `git checkout -- .vercel package-lock.json` after the run.

**Phase 1 is complete. No production code was modified.**

# INTERTEXT Architecture and Audit Report

Audited commit `bc7f84c` ("Export from Grok") on branch `claude/intertext-audit-samqpt`.
No production code was modified. Findings marked **(reproduced)** were executed against the real
modules via throwaway probe scripts, not inferred from reading.

---

## A. Architecture Summary

### Product purpose

Paste a public YouTube URL — `watch`, `youtu.be`, Shorts, live replay, embed, `music.youtube.com`,
or a raw 11-character video ID — and INTERTEXT fetches the **public caption track**, collapses
rolling auto-caption chips into readable interview paragraphs, optionally labels speakers and
writes a summary, then exports TXT / SRT / Markdown / JSON. Recent jobs persist in
`localStorage`. No audio is downloaded and no speech-to-text is run.

### Data flow

```
Workspace.runExtract                       src/components/intertext/workspace.tsx
  │
  ├─ parseYouTubeInput                     src/lib/intertext/parse-url.ts    → videoId
  │
  ├─ extractCaptions                       src/lib/intertext/client-extract.ts
  │    ├─ extractViaYtai                   src/lib/intertext/providers.ts    [BROWSER, user IP]
  │    │    └─ providerYtai → fetchYtaiOnce → parseYtaiMarkdown
  │    │
  │    ├─ extractTranscript                src/lib/intertext/extract.ts      [createServerFn POST]
  │    │    └─ runWaterfall                src/lib/intertext/providers.ts
  │    │         ├─ providerYtai                (provider 1, server IP)
  │    │         └─ providerInnertube           (provider 2)
  │    │              ├─ loadPlayer: POST youtubei/v1/player ANDROID_VR → WEB
  │    │              │              → watch-page ytInitialPlayerResponse scrape
  │    │              └─ timedtext ?fmt=json3   (parseJson3, parseTimedtextXml fallback)
  │    │         └─ toJob → cleanTranscript     src/lib/intertext/clean.ts
  │    │
  │    └─ withOembedTitle                  (youtube.com/oembed, browser)
  │
  ├─ summarizeTranscript                   src/lib/intertext/summarize.ts    [createServerFn POST]
  ├─ finishJob                             src/lib/intertext/speakers.ts     (speaker labelling)
  ├─ upsertJob                             src/lib/intertext/storage.ts      (localStorage)
  └─ ResultPane                            src/components/intertext/result-pane.tsx
       └─ export.ts                        buildTxt / buildSrt / buildMarkdown / buildJson
```

### Module interplay

**`parse-url.ts`** is the only place a user string becomes a `videoId`. It host-allowlists
(`youtube.com` and subdomains, `youtu.be`, `youtube-nocookie.com`, `music.youtube.com`), handles
path kinds (`shorts | live | embed | v | e | watch`), unwraps the `?u=` attribution redirect, and
validates against `/^[a-zA-Z0-9_-]{11}$/`. `extract.ts` re-validates with the same `isVideoId`
before any server-side fetch — **this is why there is no user-driven SSRF** despite the app making
outbound requests on the user's behalf.

**`providers.ts` (748 lines) is the risk concentration.** It holds both providers, the Markdown
parser for provider 1, the Innertube player loader, both timedtext parsers, the playability
classifier, and the waterfall's error-ranking logic. It has **zero tests**. Every Blocker and
High finding in the extraction group lives in this file.

**`clean.ts`** is the transcript-quality core, a five-stage pipeline:
`collapseRollingCaptions` (drop overlapping ASR chips) → `explodeSpeakerMarks` (split on `>>` /
`»`, lift `Name:` prefixes) → `mergeCues` (chips into sentence-like cues) → `groupCueParagraphs`
(~8–20s turns) → `mergeContainedParagraphs`. It also owns `langMatches` / `pickTrack`, which the
providers call for language policy.

**`speakers.ts`** does attribution. `cleanTranscript` calls into it during cleaning; `workspace.tsx`
calls it again post-summary via `finishJob`. Both entry points can assign speakers, and neither
requires evidence from the caption track — the source of the P17 / P18 / P19 cluster.

**Server-function boundary.** Only two `createServerFn` calls exist in product code:
`extractTranscript` and `summarizeTranscript`. Both are `POST`, both validate and clamp their
input, both return plain JSON-serializable shapes (no `Date`, `Map`, or class instances), so
TanStack Start's serialization is not a problem here. `workspace.tsx` correctly wraps both in
`useServerFn`. Verified good: the Innertube path is tree-shaken out of the client bundle
(`youtubei/v1/player` and `ytInitialPlayerResponse` each appear **0** times in
`.vercel/output/static/assets/*.js`), while the provider-1 URL does ship to the browser — which is
the documented design.

### Active product code vs. Grok-template dead weight

**Active product code** (~2.7k LOC):

| Layer | Files |
| --- | --- |
| Domain | `src/lib/intertext/{types,parse-url,clean,speakers,providers,extract,client-extract,export,storage,summarize}.ts` |
| UI | `src/components/intertext/*` (7 components), `src/routes/index.tsx`, `src/routes/__root.tsx`, `src/router.tsx` |
| Shared | `src/components/ui/{badge,button,input}.tsx`, `src/lib/{utils,theme,error-component}.ts(x)`, `src/styles.css` |
| Tests | `src/lib/intertext/{parse-url,clean,export,summarize}.test.ts` |

**Grok-template dead weight** — present, typechecked, linted and partly tested, but unreachable
from the product:

| Area | Files | Reachable? |
| --- | --- | --- |
| Better Auth | `src/lib/auth/*` (19 files), `migrations/auth/0001_auth.sql`, the `<AuthProvider>` in `__root.tsx` | **No.** `AuthProvider` is a passthrough with no imports; nothing under `src/routes`, `src/components` or `src/lib/intertext` touches `src/lib/auth`. `.grok/app-env.json` sets `VITE_AUTH_ENABLED: "false"`. |
| Database | `src/lib/db.ts`, `src/lib/app-data/*` (10 files), `scripts/migrate.mjs`, PGLite / Neon / Kysely / pg | **No.** No product code imports `@/lib/db`. `migrations/` has no top-level `.sql`, so `hasGlobbedMigrations` is false and the PGLite dev bootstrap never runs. `deploy.database` is `false`. |
| Multiplayer | `src/lib/multiplayer/{index,p2p}.ts` | **No** |
| Grok PWA / preview | `scripts/grok-pwa-*.mjs`, `scripts/preview*.mjs`, `scripts/browser-*.mjs`, `server/middleware/grok-pwa.ts`, `public/__grok/*`, `.grok/` (95 files) | Build / preview only |
| Build artefacts | `.vercel/output/**` (36 tracked files), `.grok/preview.log`, `.node_modules.lock` | Committed; should not be |
| Unused deps | 32 of 47 runtime deps have zero imports across `src/`, `server/`, `scripts/` — all 22 Radix packages, `recharts`, `cmdk`, `vaul`, `sonner`, `react-hook-form`, `@hookform/resolvers`, `react-day-picker`, `react-resizable-panels`, `@tanstack/react-table`, `@tanstack/react-query`, `date-fns`, `tw-animate-css` | No |

Per the scope constraint, this scaffolding is only reported where it **directly breaks a gate**
(P47 red tests, P48 lint errors, P46 lockfile, P45 build churn). The rest is one consolidated
maintainability entry (P49) explicitly flagged as a separate commit.

### Baseline gate status

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** (exit 0, no output) |
| `npm run build` | **PASS** — but dirties tracked files under `.vercel/output/` (P45) |
| `npm test` | **189 pass / 6 fail** — all 6 in `scripts/grok-pwa-plugin.test.mjs` (P47). All four `src/lib/intertext` suites pass. |
| `npm run lint` | **4 errors, 2 warnings** — 3 errors in `src/lib/intertext/` (P48) |

`node_modules/` was absent from the fresh clone; `npm install` rewrote `package-lock.json`
(+95 / −16 lines — P46). That change was reverted after the audit runs.

---

## B. Problem List

Severity key: **Blocker** = ships wrong data to the user or cannot deploy · **High** = frequent
wrong or broken behaviour · **Medium** = degraded behaviour or real risk · **Low** / **Nit** =
polish.

---

## B.1 — Caption extraction reliability

### Provider 1 responses are parsed regardless of HTTP status

- **ID:** P01
- **Severity:** Blocker
- **Category:** correctness
- **Evidence:** `src/lib/intertext/providers.ts` -> `fetchYtaiOnce` — the function checks only for
  `res.status === 429 || res.status === 403`, then does `const body = await res.text()` and hands
  the body straight to `parseYtaiMarkdown`. There is no `res.ok` gate and no content-type check.
- **User Impact:** **(reproduced)** A 404, 500 or 502 body becomes the transcript.
  `parseYtaiMarkdown("Not Found", id)` returns a valid capture whose only segment is
  `{ start: 0, duration: 4, text: "Not Found" }`; an HTML error page yields one segment reading
  `<!doctype html><html><body><h1>502 Bad Gateway</h1>…`. In Auto mode — the default — this counts
  as success, so `runWaterfall` returns `{ ok: true }`, the Innertube fallback never runs, and the
  user sees, exports, and persists a bogus transcript.
- **Root Cause:** "Success" is defined as "the parser did not return an error object", and
  `parseYtaiMarkdown`'s own last-resort branch (see P02) guarantees it never returns an error for
  arbitrary prose. The two defects together make any HTTP response look like a transcript.
- **Recommended Fix:** In `fetchYtaiOnce`, gate on status before reading the body: return
  `blockedError(...)` for 403/429, and `"network"` for any other non-2xx. Roughly:
  ```ts
  if (res.status === 429 || res.status === 403) return blockedError(`youtube-transcript.ai HTTP ${res.status}`);
  if (!res.ok) return "network";
  ```
- **Risk / Regression Notes:** None. Provider 1 returns 200 for real transcripts, and `"network"`
  is already the code path that falls through to the Innertube provider — so the only behaviour
  change is that broken responses now reach the fallback instead of terminating the waterfall.
- **Out of Scope:** No.

### `parseYtaiMarkdown` accepts arbitrary prose as a transcript

- **ID:** P02
- **Severity:** High
- **Category:** correctness
- **Evidence:** `src/lib/intertext/providers.ts` -> `parseYtaiMarkdown`, the `chunks.length === 0`
  branch: after stripping known header lines it does `if (!fallback) return noCaptionsError();
  chunks.push({ start: 0, text: fallback });` — i.e. any non-empty leftover text becomes a
  single untimed segment.
- **User Impact:** Even with P01 fixed, any 200 response whose shape changes — a provider
  redesign, a captcha interstitial, a rate-limit notice served as 200 — becomes one giant untimed
  paragraph presented as the transcript. Every timestamp is `0`, so the SRT export is a single
  meaningless cue and inline timestamps all read `[0:00]`.
- **Root Cause:** The fallback branch was written for a hypothetical plain-text transcript variant
  of provider 1's response, but it has no way to distinguish that from an unrelated document.
  It is an unconditional accept.
- **Recommended Fix:** Require structural evidence before accepting the fallback — proceed only
  if the document matched a `# Transcript:` / `## Transcript` heading or a `Language:` line
  earlier in the parse (both are already captured as local variables). Otherwise return
  `noCaptionsError()`.
- **Risk / Regression Notes:** Could reject a legitimate timestamp-free response if provider 1
  ever serves one without headers. Mitigated by keying on the headers the parser already reads
  rather than on timestamps alone. Add the fixture tests from P51 before changing this.
- **Out of Scope:** No.

### An unlabelled (`und`) capture short-circuits the waterfall in Auto mode

- **ID:** P03
- **Severity:** High
- **Category:** reliability
- **Evidence:** `src/lib/intertext/providers.ts` -> `providerYtai` / `runWaterfall` — the auto
  branch returns `fallback` whenever it is not an error, and `runWaterfall` accepts any non-error
  first result with `return { ok: true, job: toJob(...) }`. The language sanity check
  (`langMatches(first.language, lang)`) is guarded by `lang !== "auto"`, so it never runs in the
  default mode.
- **User Impact:** In Auto — the default and the mode the README recommends — a degenerate capture
  (language `und`, one segment, no duration) is treated as a successful extraction. The Innertube
  provider, which would have produced a real multi-hundred-segment caption track, is never called.
  The user has no indication that a second provider existed.
- **Root Cause:** There is no minimum-quality gate between "the parser returned without an error"
  and "this is a usable transcript". The waterfall's only success criterion is the absence of an
  error object.
- **Recommended Fix:** In `runWaterfall`, accept provider 1's result only when it clears a floor —
  `first.segments.length >= 3` **or** `first.language !== "und"`. Otherwise fall through to
  `providerInnertube` and return whichever produced more segments.
- **Risk / Regression Notes:** A genuinely tiny video (a 5-second Short with two caption chips)
  would now also hit provider 2 — acceptable latency cost, and provider 2 succeeds on those too.
  Keep provider 1's result as the fallback if provider 2 fails, so this never turns a weak success
  into a failure.
- **Out of Scope:** No.

### Age-restricted and members-only videos are reported as "no public captions"

- **ID:** P04
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/lib/intertext/providers.ts` -> `runWaterfall` — the failure-merging block:
  ```ts
  if (second.code === "no_captions" || second.code === "language_missing") {
    return { ok: false, error: second };
  }
  return { ok: false, error: first };
  ```
- **User Impact:** When provider 1 correctly classifies a video as `age_restricted` or
  `members_only`, and Innertube — which requests unsigned and therefore cannot see the tracks —
  reports `no_captions`, the specific diagnosis is discarded. The user is told "No public captions
  were found for this video" and pointed at `yt-dlp`, which will fail for exactly the same reason.
  `classifyPlayability` already wrote precise, actionable copy ("Open it on YouTube while signed
  in, then More → Show transcript") and it is thrown away.
- **Root Cause:** The comment reads "Prefer the more specific of the two failures", but the code
  encodes the assumption that `no_captions` is more specific than a playability classification.
  The opposite is true: `no_captions` is the least informative code in the union.
- **Recommended Fix:** Replace the ad-hoc branch with an explicit rank, highest first:
  `age_restricted`, `members_only`, `unavailable`, `language_missing`, `no_captions`,
  `provider_blocked`, `network` — then return whichever of `first` / `second` ranks higher.
- **Risk / Regression Notes:** A false `age_restricted` from provider 1 would now win over a
  correct `no_captions`. Low risk: that classification requires an explicit reason string
  containing "age" / "inappropriate" / "confirm your age".
- **Out of Scope:** No.

### Worst-case waterfall latency exceeds the deployed function limit

- **ID:** P05
- **Severity:** High
- **Category:** reliability
- **Evidence:** `src/lib/intertext/providers.ts` -> `fetchOk` / `providerYtai` / `loadPlayer` —
  provider 1 can make 4 requests at 14s each (P06), `loadPlayer` makes 3 at 14s, and timedtext
  gets 16s: roughly **114s** worst case for `extractTranscript`.
  `src/lib/intertext/summarize.ts` -> `chat` uses `AbortSignal.timeout(70_000)` and can be called
  up to 7 times. `.vercel/output/functions/__server.func/.vc-config.json` declares no
  `maxDuration`, so Vercel's platform default applies (10s Hobby / 15s Pro).
- **User Impact:** On the deployed app a slow-but-recoverable extraction is killed by the platform
  mid-flight. `client-extract.ts`'s catch turns the resulting transport error into a generic
  "Network error reaching caption providers" with no hint that a timeout occurred, so the user
  retries into the same wall. Long videos hit the same limit again during summarize.
- **Root Cause:** Per-request timeouts were sized for the local dev server, where a long-running
  handler is free. There is no whole-request deadline, so the individual budgets add up without
  bound.
- **Recommended Fix:** Create one `AbortSignal.timeout(25_000)` at the top of `runWaterfall`,
  thread it through every `fetchOk` call (combine with the per-call signal via
  `AbortSignal.any`), and drop the per-call budgets to ~6–8s. Separately, declare a `maxDuration`
  for the server function so the platform limit is explicit rather than inherited.
- **Risk / Regression Notes:** Shorter timeouts will increase spurious `network` errors on slow
  connections — land this together with the visible retry from P36 so the user has a recovery
  path. Do **not** attempt to raise the limit by moving work to the filesystem or a background
  process; neither survives on Vercel.
- **Out of Scope:** No.

### Auto mode issues up to four provider-1 requests, one a duplicate

- **ID:** P06
- **Severity:** Medium
- **Category:** performance
- **Evidence:** `src/lib/intertext/providers.ts` -> `providerYtai` — the `lang === "auto"`
  pre-flight calls `fetchYtaiOnce(videoId, undefined)`; when that returns a *soft* error control
  falls through to the loop below, whose `langsToTry` is `["ko", "en", undefined]` and whose
  `seen` set is freshly constructed — so the unspecified-language request is issued a second time.
- **User Impact:** Up to 4 × 14s of latency before provider 2 is even attempted (a direct
  contributor to P05), and 4× the request load on a provider the README describes as "fair-use,
  not a bulk scraping API".
- **Root Cause:** The auto pre-flight block and the generic language loop were written
  independently and share no request memo; `seen` is scoped to the loop rather than the function.
- **Recommended Fix:** Hoist a `Map<string, RawCapture | ExtractError | "network">` to the top of
  `providerYtai`, keyed by `attempt ?? "*"`, and have both blocks read through it — so each
  `(videoId, lang)` pair is fetched at most once per extraction.
- **Risk / Regression Notes:** None. The memo is per-call, so nothing is cached across requests
  and no staleness is introduced.
- **Out of Scope:** No.

### Innertube client names and versions are hardcoded and already stale

- **ID:** P07
- **Severity:** Medium
- **Category:** reliability
- **Evidence:** `src/lib/intertext/providers.ts` -> `loadPlayer` —
  `postInnertube(videoId, "ANDROID_VR", "1.57.29", { androidSdkVersion: 32 })` followed by
  `postInnertube(videoId, "WEB", "2.20240101.00.00")`. The WEB version string is dated January 2024.
- **User Impact:** When YouTube retires a client version, `postInnertube` still returns 200 but
  with no `captionTracks`, so `loadPlayer` silently falls through to the watch-page scrape. If
  that is bot-checked the user sees `provider_blocked` — with no signal that the app's own
  constants, not YouTube's policy, caused the failure.
- **Root Cause:** No indirection for the client matrix and no telemetry distinguishing "this
  client was rejected" from "this video has no captions". Both produce an empty `captionTracks`.
- **Recommended Fix:** Extract the matrix into one exported `const INNERTUBE_CLIENTS` with a
  comment recording the date it was last verified, and record which client produced the player in
  `ExtractError.details` so a failure is diagnosable from the UI's details line.
- **Risk / Regression Notes:** None — constants and a details string only. Note that keeping the
  versions current is ongoing maintenance, not a one-time fix; the structural change is what makes
  that maintenance cheap.
- **Out of Scope:** No.

### Every non-OK `timedtext` status is reported as "blocked"

- **ID:** P08
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/lib/intertext/providers.ts` -> `providerInnertube` —
  `if (!capRes.ok) return blockedError(\`timedtext HTTP ${capRes.status}\`);`
- **User Impact:** A 404 — which for timedtext means the `baseUrl`'s signed, time-limited token
  has expired — tells the user "Caption providers were blocked or rate-limited. Wait a moment and
  retry." Waiting makes it strictly worse; the player response has to be re-fetched to get a fresh
  URL. The user follows advice that cannot work.
- **Root Cause:** One error constructor covers the whole status space, so a recoverable staleness
  condition is presented as an external block.
- **Recommended Fix:** Branch on status: 403/429 → `provider_blocked`; 404/410 → re-run
  `loadPlayer` once for a fresh `baseUrl` and only then fall back to `noCaptionsError()`;
  5xx → `networkError(...)`.
- **Risk / Regression Notes:** The single retry adds one request on an uncommon path. Guard it
  with a boolean so it cannot recurse, and count it against the P05 deadline.
- **Out of Scope:** No.

### No size limit on any provider response body

- **ID:** P09
- **Severity:** Medium
- **Category:** security
- **Evidence:** `src/lib/intertext/providers.ts` -> `fetchYtaiOnce`, `playerFromWatchPage`,
  `providerInnertube` — all three do an unbounded `await res.text()`. `playerFromWatchPage` then
  passes the whole document to `extractJsonAfter`, which walks it character by character tracking
  brace depth and string state.
- **User Impact:** A YouTube watch page is routinely 1–3 MB; a hostile or malfunctioning
  provider-1 response is unbounded. On a serverless function this is memory pressure plus, via the
  linear brace scan, CPU burn — a cheap way for a single request to exhaust the function and take
  down extraction for everyone. Combined with P43 (no rate limit) this is trivially reachable.
- **Root Cause:** `fetchOk` applies a time budget via `AbortSignal.timeout` but no byte budget,
  and `extractJsonAfter` has no scan-length bound.
- **Recommended Fix:** Read through `res.body` with a running byte counter and abort past a cap
  (~4 MB for the watch page, ~2 MB for transcript bodies); add a maximum scan length to
  `extractJsonAfter`.
- **Risk / Regression Notes:** A legitimately huge watch page would be rejected — 4 MB is generous
  headroom over observed sizes. Streaming reads must still respect the abort signal so the P05
  deadline continues to apply.
- **Out of Scope:** No.

### `captionTracks[].baseUrl` is fetched with no host allowlist

- **ID:** P10
- **Severity:** Low
- **Category:** security
- **Evidence:** `src/lib/intertext/providers.ts` -> `providerInnertube` —
  `const timedtextUrl = withJson3(chosen.baseUrl);` then `fetchOk(timedtextUrl, …)`. The URL is
  taken from the player response and fetched without inspecting its host.
- **User Impact:** None today. The URL originates from YouTube's own player response, and the only
  user-controlled input (`videoId`) is validated by `isVideoId` in `extract.ts` before any fetch —
  so there is **no user-driven SSRF**. The gap is that the server will follow whatever host that
  field happens to name.
- **Root Cause:** The upstream response is trusted transitively: because the player payload came
  from YouTube, every field inside it is treated as safe to dereference.
- **Recommended Fix:** Before fetching, assert the host:
  ```ts
  const host = new URL(chosen.baseUrl).hostname;
  if (!/(^|\.)(youtube\.com|googlevideo\.com)$/.test(host)) return blockedError("unexpected timedtext host");
  ```
- **Risk / Regression Notes:** None, provided the regex anchors on a dot boundary so
  `evilyoutube.com` does not match. Wrap the `new URL` in a try/catch — a malformed `baseUrl`
  should fail closed, not throw.
- **Out of Scope:** No — cheap defence in depth on the one outbound URL the app does not construct
  itself.

### `parseAvailableLangs` depends on an undocumented `Name (code)` format

- **ID:** P11
- **Severity:** Low
- **Category:** reliability
- **Evidence:** `src/lib/intertext/providers.ts` -> `parseAvailableLangs` —
  `/([a-zA-Z][\w-]*)\s*\(([\w-]+)\)(\s*\[auto\])?/g` applied to the text after
  `Other available languages:`.
- **User Impact:** If provider 1 changes that line's format, `availableLanguages` collapses to just
  the detected track (which `parseYtaiMarkdown` unshifts). `languageMissing` then offers as a
  "fallback" the language the user already has, and the "Available: …" list vanishes from the error
  message — so the user is told a language is missing without being told what exists.
- **Root Cause:** Screen-scraping a human-readable line that carries no schema or version marker.
- **Recommended Fix:** Keep the regex, but add a fixture test pinning the current format so a
  provider change fails loudly, and have `languageMissing` say "could not read the language list"
  rather than implying none exists when the parse comes back empty.
- **Risk / Regression Notes:** None — the fix is a test plus error copy.
- **Out of Scope:** No.

### The final provider-1 chunk gets a synthetic 4-second duration

- **ID:** P12
- **Severity:** Low
- **Category:** correctness
- **Evidence:** `src/lib/intertext/providers.ts` -> `parseYtaiMarkdown` —
  `const duration = next ? Math.max(0.4, next.start - chunk.start) : Math.max(0.4, 4);`
- **User Impact:** The last SRT cue ends at an invented time, and when the `Duration:` header is
  absent `durationSec` is short by however long the closing remark actually ran — so the result
  pane's duration badge under-reports the video length.
- **Root Cause:** Provider 1's Markdown supplies start times only, so the last chunk's end has to
  be inferred, and the inference is a hardcoded constant.
- **Recommended Fix:** When `durationSec` is known, clamp the last chunk to
  `durationSec - chunk.start`; otherwise use the median of the preceding inter-chunk gaps instead
  of the literal `4`.
- **Risk / Regression Notes:** None, provided the clamp floors at `0.4` so a `durationSec` smaller
  than the last start cannot produce a negative duration.
- **Out of Scope:** No.

### The language-fallback CTA collapses every non-ko/en track to "Auto"

- **ID:** P13
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/components/intertext/workspace.tsx` -> the `error.code === "language_missing"`
  branch:
  ```ts
  const next = error.fallbackLang?.toLowerCase().startsWith("ko") ? "ko"
    : error.fallbackLang?.toLowerCase().startsWith("en") ? "en" : "auto";
  ```
  with `languageName(code)` returning the raw code for anything outside ko/en.
- **User Impact:** For a Japanese-only video the button reads "Extract ja instead" but sets the
  mode to **Auto**, which re-runs the same ko → en → first-track preference — it never requests
  `ja`. The button's label and its behaviour disagree. If Auto then fails the same way, the CTA
  reappears and the user can loop indefinitely.
- **Root Cause:** `LangMode` in `types.ts` is a closed union `"auto" | "ko" | "en"`, so an
  arbitrary `fallbackLang` string has nowhere to go in the extract path.
- **Recommended Fix:** Two options. Minimal: relabel to "Extract the available track (ja)" so the
  copy matches what Auto actually does. Complete: widen the extract input to carry an explicit
  code and have `providerYtai` / `pickInnertubeTrack` honour it.
- **Risk / Regression Notes:** The complete fix touches `extract.ts`'s validator (which currently
  hard-rejects anything but `auto`/`ko`/`en`), `storage.ts`'s persisted `requestedLang`, and the
  segmented control — so old localStorage jobs must still deserialize. Do the minimal relabel
  first if this is not being taken on wholesale.
- **Out of Scope:** No.

### URL parsing covers the documented forms but tests miss two

- **ID:** P14
- **Severity:** Nit
- **Category:** tests
- **Evidence:** `src/lib/intertext/parse-url.test.ts` — exercises watch, `youtu.be`, shorts, live,
  embed and `youtube-nocookie`, but not `music.youtube.com/watch?v=` (allowed by `YT_HOSTS`) and
  not the `?u=` attribution unwrap (handled in `parseYouTubeInput`).
- **User Impact:** None observed — both paths work correctly today. Untested branches regress
  silently.
- **Root Cause:** The test was written from the README's headline list of URL forms rather than
  from the parser's actual branch coverage.
- **Recommended Fix:** Add two `it()` cases to the existing `describe("parseYouTubeInput")` block.
- **Risk / Regression Notes:** None — test-only addition.
- **Out of Scope:** No.

### `parseYouTubeInput` recurses on `?u=` with no depth guard

- **ID:** P15
- **Severity:** Low
- **Category:** reliability
- **Evidence:** `src/lib/intertext/parse-url.ts` -> `parseYouTubeInput` — the attribution branch
  calls `parseYouTubeInput(innerPath)` recursively with no depth counter and no input-length cap.
- **User Impact:** Each level consumes input, so recursion is bounded by string length — but a
  large pasted string of nested `?u=` values can reach a deep stack in the browser tab. This runs
  client-side only, so the blast radius is the user's own tab.
- **Root Cause:** No explicit bound on either recursion depth or accepted input length.
- **Recommended Fix:** Add a `depth = 0` parameter, return the invalid-input message at `depth > 3`,
  and reject inputs longer than ~2 KB up front (a YouTube URL is never close to that).
- **Risk / Regression Notes:** None, as long as the depth parameter is optional so the exported
  single-argument signature used by `workspace.tsx` and the tests is unchanged.
- **Out of Scope:** No.

### Any 11-character token is accepted as a video ID before URL parsing

- **ID:** P16
- **Severity:** Low
- **Category:** UX
- **Evidence:** `src/lib/intertext/parse-url.ts` -> `parseYouTubeInput` — `if (isVideoId(originalInput))
  return success(...)` runs before the `new URL(...)` attempt, and `VIDEO_ID_RE` is
  `/^[a-zA-Z0-9_-]{11}$/`.
- **User Impact:** Pasting an 11-character word (`hello_world`, `interviewX`) skips the "That does
  not look like a YouTube URL or video ID" message and instead triggers a full provider round-trip
  ending in "No public captions were found for this video" — a confidently wrong diagnosis for
  what is really a typo.
- **Root Cause:** Real YouTube IDs are genuinely indistinguishable from arbitrary 11-character
  tokens; the ambiguity is inherent, not a parser bug.
- **Recommended Fix:** Keep accepting them — it is the documented input. When a raw-ID extraction
  fails, append "Check that this is a video ID and not a typo" to the `no_captions` message, gated
  on the input having been a bare ID rather than a URL.
- **Risk / Regression Notes:** None; requires threading a small flag from `VideoRef` (which already
  carries `originalInput`) into the error copy.
- **Out of Scope:** No.

### Live streams and premieres are not detected

- **ID:** P17
- **Severity:** Low
- **Category:** UX
- **Evidence:** `src/lib/intertext/providers.ts` -> `classifyPlayability` / `providerInnertube` —
  the classifier inspects only `playabilityStatus.status` and `.reason`; `videoDetails.isLive` and
  `isLiveContent` are available in the player payload and never read.
- **User Impact:** A live stream or in-progress premiere has no stable caption track, so the user
  gets the generic "No public captions were found" plus the yt-dlp suggestion, which will also
  fail. The README already tells users that live replays work later, but the app cannot say so at
  the moment it matters.
- **Root Cause:** The playability classifier was built around the error/reason strings and never
  extended to the live flags, which live on a different part of the payload.
- **Recommended Fix:** In `providerInnertube`, when `tracks.length === 0` and
  `player.videoDetails?.isLive` is true, return a dedicated message — "This is live right now.
  The transcript appears once the replay is published" — reusing the `no_captions` code so no new
  error code is needed.
- **Risk / Regression Notes:** None; a narrower message on an existing code. The inability to
  transcribe a live stream is a documented limit — this improves the explanation only, it does not
  attempt to work around the limit.
- **Out of Scope:** No — the limit is documented, but the misleading error copy is not.

---

## B.2 — Transcript quality and speaker attribution

### Without a model key, every paragraph is labelled with the summary's heading

- **ID:** P18
- **Severity:** Blocker
- **Category:** correctness
- **Evidence:** A four-link chain across three files.
  1. `src/lib/intertext/summarize.ts` -> `fallbackSummary` returns `"Interview key points:\n- …"`
     — its `kindLabel` heading — whenever `XAI_API_KEY` is unset.
  2. `src/lib/intertext/summarize.ts` -> the handler's `fail()` returns
     `speakers: speakersFromSummary(summary)`, mining its own generated text.
  3. `src/lib/intertext/speakers.ts` -> `speakersFromSummary` matches
     `^\s*[-*•]?\s*(Name)\s*[:：]`, so the heading matches; at 20 characters and 3 words it clears
     every `isFalseSpeaker` rule.
  4. `src/components/intertext/workspace.tsx` -> `finishJob` calls
     `labelInterviewByRole(paragraphs, ["Interview key points"])`; with `names.length === 1` the
     function assigns that name to **every** paragraph.
- **User Impact:** **(reproduced)** In the **default configuration** — `summaryKind` defaults to
  `"interview"` in `workspace.tsx`, and the no-model fallback is a documented supported path —
  every transcript paragraph is prefixed `Interview key points:`. Probe output:
  ```
  NAMES:   ["Interview key points"]
  LABELED: ["Interview key points","Interview key points","Interview key points"]
  ```
  The prefix is rendered on screen, written into the TXT, SRT, Markdown and JSON exports, and
  persisted to `localStorage`, so reopening the job reproduces it.
- **Root Cause:** Two independent defects compounding: a summary heading that ends in a colon
  (which P20's regex reads as a speaker label) and a single-name interview path that labels
  unconditionally (P19). Neither alone would be visible; together they corrupt the default output.
- **Recommended Fix:** Two minimal edits, both in `summarize.ts`. (a) Emit the heading so it cannot
  parse as a label — `## Interview key points` rather than `Interview key points:`. (b) Have
  `fail()` return `speakers: []` instead of mining its own text; the fallback summary is generated
  from the transcript and contains no speaker information, so there is nothing legitimate to
  extract. Fix P19 and P20 in the same change.
- **Risk / Regression Notes:** `summarize.test.ts` asserts on `fallbackSummary`'s bullets
  (`assert.match(text, /^- /m)`) and never on the heading, so (a) is safe. (b) means the interview
  path produces no speaker labels without a model — which is the correct, documented behaviour
  ("it does not invent speaker names"), and which the P19 fix makes explicit rather than
  accidental.
- **Out of Scope:** No.

### `labelInterviewByRole` invents host/guest attribution for every paragraph

- **ID:** P19
- **Severity:** High
- **Category:** correctness
- **Evidence:** `src/lib/intertext/speakers.ts` -> `labelInterviewByRole` — with two names it
  assigns a speaker to **every** paragraph from text heuristics alone:
  ```ts
  if (looksLikeQuestion(p.text)) speaker = host;
  else if (long && last === host) speaker = guest;
  else if (brief && last === guest && i > 0) speaker = host;
  ```
  There is no check that the caption track contains any turn evidence, and no abstain path.
- **User Impact:** **(reproduced)** A lecture, a solo podcast, or any single-speaker video is
  rendered as a two-person dialogue. Probe on a monologue with `["진행자", "성상현"]`:
  ```
  ["성상현", "진행자", "성상현", "진행자"]
  ```
  Because `workspace.tsx` defaults `summaryKind` to `"interview"`, this is the default path. The
  fabricated labels reach every export, and there is no UI control to turn them off.
- **Root Cause:** The function's contract is "given names, assign roles", with no precondition that
  the source is actually a dialogue. The decision to call it is made from the user's chosen summary
  *type*, which is a formatting preference, not evidence about the audio.
- **Recommended Fix:** Gate the call on turn evidence that the pipeline already computes:
  `explodeSpeakerMarks` sets `turnMark` on cues split by `>>` / `»` and lifts `Name:` prefixes. In
  `finishJob`, run `labelInterviewByRole` only when some paragraph carries `turnMark` or a
  pre-existing `speaker`; otherwise return the paragraphs unlabelled.
- **Risk / Regression Notes:** `clean.test.ts` "labels host questions and guest answers without
  adding lines" asserts current behaviour on a `>>`-marked fixture — which *does* carry turn
  evidence, so it should still pass; verify rather than assume. Consider surfacing a "speaker
  labels are inferred" note in the result pane when labels are heuristic rather than read from the
  track.
- **Out of Scope:** No. This is not the documented "cannot invent speaker names" limit — the names
  come from the model, but the *attribution* of lines to those names is fabricated.

### `speakersFromSummary` treats any `Word:` bullet prefix as a person

- **ID:** P20
- **Severity:** High
- **Category:** correctness
- **Evidence:** `src/lib/intertext/speakers.ts` -> `speakersFromSummary` — the regex
  `/(?:^|\n)\s*[-*•]?\s*(?:\*\*)?([A-Za-z가-힣][A-Za-z가-힣0-9·.\s]{0,24}?)(?:\*\*)?\s*[:：]/g`
  matches any short token followed by a colon. `isFalseSpeaker`'s blocklist covers `summary`,
  `overview`, `note`, `요약`, `제목` — nothing generic.
- **User Impact:** **(reproduced)** Input
  `"- 결론: 금리는 내린다.\n- Key point: liquidity matters.\n- Action items: review Q3."`
  returns `["결론", "Key point", "Action items"]`. Topic-prefixed bullets are a very common summary
  shape — especially for the `meeting` and `course` types, whose prompts explicitly ask for
  "decisions, action items" and "objectives, concepts". Combined with P19, these fabricated names
  become the "host" and "guest" of the whole transcript.
- **Root Cause:** The regex cannot distinguish `Name:` from `Topic:` — both are syntactically
  identical — and there is no cross-check against the transcript to confirm the candidate ever
  appears as a speaker label in the source.
- **Recommended Fix:** Require corroboration. Accept a candidate only if it also appears as a
  `Name:` prefix among the cleaned cues (`peelSpeaker` already extracts those), or if it came from
  the model's explicit `speakers` array. Demote `speakersFromSummary` from default to last resort.
- **Risk / Regression Notes:** `summarize.test.ts` "falls back to bullet names when JSON speakers
  are missing" asserts `["진행자", "성상현"]` from a bullet-only summary with no transcript in
  scope; that test needs either a stubbed corroboration source or a fixture extended with matching
  cues. Do not weaken the assertion — extend the fixture.
- **Out of Scope:** No.

### The model's `turns` are parsed and then discarded

- **ID:** P21
- **Severity:** Medium
- **Category:** maintainability
- **Evidence:** `src/lib/intertext/summarize.ts` -> `parseSummaryPayload` builds a validated
  `turns: SpeakerTurn[]`, but **both** success returns in the handler hardcode `turns: []`:
  ```ts
  return { ok: true, summary: parsed.summary, speakers: parsed.speakers, turns: [], source: "model" };
  ```
  `finalPrompt` never requests the field either — it asks for
  `{ "summary": "…", "speakers": ["…","…"] }`.
- **User Impact:** In `workspace.tsx`,
  `turns.length > 0 ? applySpeakerNames(job.paragraphs, names, turns) : labelInterviewByRole(...)`
  can never take the first branch. The *accurate* per-paragraph attribution path — the one that
  uses the model's actual reading of who said what — is dead code, so the *heuristic* path (P19)
  always runs, even when a model key is configured and paid for.
- **Root Cause:** The prompt, the parser and the return value were built in three steps and the
  wiring between them was never completed; the parser and the consumer both exist and are correct.
- **Recommended Fix:** Add `turns` to `finalPrompt`'s requested JSON
  (`{"i": <paragraph index>, "speaker": "…"}`) and return `parsed.turns` / `again.turns` instead
  of the literal `[]`.
- **Risk / Regression Notes:** Turns increase output tokens against `max_tokens: 1400` — measure
  on a long transcript before shipping. `applySpeakerNames` already range-validates `t.i` against
  `paragraphs.length`, so a hallucinated index is dropped rather than throwing. Land with P19 so
  that an absent or empty `turns` means "no labels", not "fall back to guessing".
- **Out of Scope:** No.

### The no-model summary is always English-framed, even for Korean transcripts

- **ID:** P22
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/lib/intertext/summarize.ts` -> `fallbackSummary` — emits
  `"Interview key points:"` / `"Meeting key points:"` / `"Talk key points:"` regardless of
  language. `languageHint`, which correctly detects Hangul and returns "Write the entire summary
  in Korean", is used only to build model prompts and is never consulted here.
- **User Impact:** A Korean interview extracted with no API key gets a Korean bullet list under an
  English heading, and that mixed-language block is written into every export. The README's
  language policy promises Korean is handled end to end.
- **Root Cause:** `fallbackSummary` predates the language hint and takes no `language` parameter,
  so it has nothing to branch on.
- **Recommended Fix:** Pass `data.language` into `fallbackSummary` (the handler already has it) and
  select the heading from it — `인터뷰 핵심 요지` / `회의 핵심 요지` / `핵심 요지`.
- **Risk / Regression Notes:** `summarize.test.ts` calls `fallbackSummary(title, kind, paragraphs)`
  with three arguments and asserts nothing about the heading, so make the new parameter optional
  to keep that call site compiling. This interacts with P18 — the heading is the string that
  becomes a fake speaker — so fix both together and re-run the probe.
- **Out of Scope:** No.

### `fillSpeakerGaps` back-fills labels onto paragraphs that had no evidence

- **ID:** P23
- **Severity:** Low
- **Category:** correctness
- **Evidence:** `src/lib/intertext/speakers.ts` -> `fillSpeakerGaps` — a forward pass carries the
  last seen speaker forward, then a **backward** pass assigns the next known speaker to everything
  before the first labelled turn. `clean.ts` -> `cleanTranscript` applies it whenever *any*
  paragraph has a speaker.
- **User Impact:** An intro monologue that precedes the first `>>` marker is attributed to whoever
  speaks after it — so the opening of an interview is credited to the wrong person.
- **Root Cause:** The backward pass exists to avoid a leading run of unlabelled paragraphs, but it
  has no distance, pause or evidence limit — it will reach arbitrarily far back.
- **Recommended Fix:** Bound the backward pass: back-fill only across a small gap (under ~2s, with
  no intervening `turnMark`); otherwise leave the paragraph unlabelled.
- **Risk / Regression Notes:** Produces more unlabelled paragraphs, which is the safer default and
  consistent with the P19 fix. Check `clean.test.ts`'s speaker fixtures still pass.
- **Out of Scope:** No.

### `dedupeRepeatedPhrases` can delete legitimate repetition

- **ID:** P24
- **Severity:** Low
- **Category:** correctness
- **Evidence:** `src/lib/intertext/clean.ts` -> `dedupeRepeatedPhrases` —
  `t.replace(/([가-힣]{2,8})(?:\s*\1){2,}/g, "$1")` and
  `t.replace(/\b([A-Za-z]{3,})\b(?:\s+\1\b){2,}/gi, "$1")`, applied in a loop of up to 8 passes.
  It is called at chip level, at cue level and again at paragraph level.
- **User Impact:** Genuine emphatic repetition — "네 네 네", "no no no" — collapses to a single
  token, changing what the speaker actually said. The module's own docstring promises the cleaner
  "Keeps original wording".
- **Root Cause:** One rule serves two different jobs. Rolling-window ASR chips genuinely need
  aggressive de-duplication; prose that has already been merged does not, and at that stage
  repetition is signal rather than artefact.
- **Recommended Fix:** Apply the aggressive triple-repeat rules only inside
  `collapseRollingCaptions`, where overlapping chips are the input, and use a conservative variant
  (adjacent-identical-sentence removal only) for cue- and paragraph-level text.
- **Risk / Regression Notes:** Some rolling-caption artefacts would survive into paragraphs.
  `clean.test.ts` "collapses a word repeated three times" pins the current behaviour and would need
  to move to the chip-level function rather than being deleted.
- **Out of Scope:** No.

---

## B.3 — Exports

### Export filenames omit the `_{lang}` suffix the README documents

- **ID:** P25
- **Severity:** Medium
- **Category:** correctness
- **Evidence:** `README.md` states "Filenames: `{sanitizedTitle-or-videoId}_{lang}.{ext}`".
  `src/lib/intertext/export.ts` -> `exportBasename` returns
  `sanitizeFilename(job.title, job.videoId)` with no language component, and
  `result-pane.tsx` -> `download` writes `${base}.txt`. `export.test.ts` actively pins the current
  behaviour: `assert.equal(exportBasename(job).includes("_ko"), false);`
- **User Impact:** Extracting the same video in Korean and then in English writes the same filename
  twice. The browser silently appends " (1)" and the two files become indistinguishable without
  opening them — exactly the collision the documented naming scheme was designed to prevent.
- **Root Cause:** The README and the test encode opposite intentions. One was changed without the
  other, and the test locks in the undocumented behaviour.
- **Recommended Fix:** Implement the documented scheme — `${exportBasename(job)}_${job.language}.${ext}`
  in `result-pane.tsx`'s `download` — and update the test assertion to expect `_ko`.
- **Risk / Regression Notes:** `export.test.ts` fails until updated; that is the intended signal,
  not a regression. Guard against `job.language` being `und` or empty (P03's degenerate captures)
  so the suffix never becomes a bare trailing underscore.
- **Out of Scope:** No.

### The README's JSON and Markdown schemas do not match the code

- **ID:** P26
- **Severity:** Medium
- **Category:** maintainability
- **Evidence:** `README.md` documents "JSON | `{ videoId, url, language, sourceType, segments[] }`",
  but `src/lib/intertext/export.ts` -> `buildJson` also emits `title`, `provider`, `summaryKind`,
  `summary` and a full `paragraphs[]` array. The README documents "Markdown | Title, source URL,
  language, transcript", but `buildMarkdown` also emits a `Provider:` line and a `## Summary`
  section.
- **User Impact:** Anyone scripting against the documented JSON shape works from a stale contract.
  Worse, `paragraphs[]` — the readable, cleaned output that is the app's actual value-add — is
  undocumented, so a consumer following the README would parse the raw `segments[]` instead.
- **Root Cause:** The export functions grew past the README and nothing enforces agreement.
- **Recommended Fix:** Update the README table to the emitted shape and label it as the contract.
- **Risk / Regression Notes:** None — documentation only. Consider a test that round-trips
  `buildJson` through `JSON.parse` and asserts the key set, so future drift fails a gate.
- **Out of Scope:** No.

### "Copy" copies title, summary and transcript, not the visible transcript

- **ID:** P27
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `README.md` states "Copy copies the visible transcript, not JSON."
  `src/components/intertext/result-pane.tsx` -> `copyVisible` writes
  `fullText = composeDocument(job, tsMode)`, which is title + summary + transcript. The button
  reads "Copy text".
- **User Impact:** A user who has searched and is looking at 3 filtered paragraphs presses Copy and
  receives the entire document including the summary. There is no way to copy only the transcript,
  and no way to copy only what is on screen — so the search feature and the copy feature do not
  compose.
- **Root Cause:** `composeDocument` is the TXT export body and was reused verbatim for the
  clipboard, so Copy inherited export semantics rather than view semantics.
- **Recommended Fix:** Minimal: relabel to "Copy document" and correct the README. Better: two
  buttons — "Copy transcript" (`visibleTranscript(job.paragraphs, tsMode)`) and "Copy with
  summary" (`composeDocument`).
- **Risk / Regression Notes:** None for the relabel. If the copy is made search-aware, decide
  deliberately whether a filtered copy is desirable — silently copying only matches would surprise
  users differently.
- **Out of Scope:** No.

### The Windows BOM checkbox only affects TXT

- **ID:** P28
- **Severity:** Low
- **Category:** UX
- **Evidence:** `src/components/intertext/result-pane.tsx` -> `download` passes `bom` for the
  `txt` branch and hardcodes `false` for `srt`, `md` and `json`. The label reads
  "Windows-friendly TXT (UTF-8 BOM)".
- **User Impact:** The label is honest about its scope, but the Windows Hangul mojibake problem the
  checkbox exists to solve also hits SRT opened in Notepad and Markdown opened in legacy editors.
  A Korean SRT is precisely the case that breaks, and the option that would fix it does not apply.
- **Root Cause:** The option was scoped to TXT when added and never extended as the other exports
  landed.
- **Recommended Fix:** Pass `bom` to the SRT and Markdown branches too — never JSON, where a BOM
  breaks `JSON.parse` — and relabel to "Windows-friendly text files (UTF-8 BOM)".
- **Risk / Regression Notes:** Some SRT players mishandle a leading BOM. Keep the checkbox as an
  opt-out and consider defaulting it off for SRT specifically; `downloadUtf8` already takes `bom`
  per call, so this is per-format, not global.
- **Out of Scope:** No.

### SRT cues can overlap, and the final cue has an invented end time

- **ID:** P29
- **Severity:** Low
- **Category:** correctness
- **Evidence:** `src/lib/intertext/export.ts` -> `buildSrt` computes
  `end = formatSrtTime(seg.start + Math.max(seg.duration, 0.4))` per segment with no clamp against
  the next segment's start. Upstream, `clean.ts` -> `mergeCues` extends `prev.duration` to
  `next.start + next.duration - prev.start`, and `speakers.ts` -> `explodeSpeakerMarks` splits one
  cue into sub-cues by character ratio — both can produce a cue ending after the following cue
  begins. P12 supplies the last cue's synthetic duration.
- **User Impact:** Strict SRT consumers reject overlapping cues outright; permissive players show
  two subtitles stacked on screen. Cue numbering itself is correct (sequential from 1) and the
  `HH:MM:SS,mmm --> HH:MM:SS,mmm` format is correct — the defect is purely the timing overlap.
- **Root Cause:** `buildSrt` treats each segment independently and never looks at its neighbour,
  while the cleaning pipeline deliberately extends durations to absorb merged chips.
- **Recommended Fix:** In `buildSrt`, clamp each cue's end to
  `Math.min(seg.start + duration, nextStart - 0.001)`, and clamp the final cue to
  `job.durationSec` when it is known and greater than the cue's start.
- **Risk / Regression Notes:** `export.test.ts` asserts the first cue's exact timing
  (`00:00:00,000 --> 00:00:04,000`) on a fixture whose next segment starts at 4 — the clamp yields
  `00:00:03,999`, so that assertion must be updated deliberately rather than treated as a break.
- **Out of Scope:** No.

### `revokeObjectURL` fires immediately after `click()`

- **ID:** P30
- **Severity:** Low
- **Category:** reliability
- **Evidence:** `src/lib/intertext/export.ts` -> `downloadUtf8` — the sequence
  `a.click(); a.remove(); URL.revokeObjectURL(href);` runs synchronously in one tick.
- **User Impact:** Some browsers — Safari in particular — have not begun reading the blob when the
  object URL is revoked, so the download fails with no error shown. The user presses a download
  button and nothing happens.
- **Root Cause:** The blob URL's lifetime is assumed to outlast the synchronous click handler; in
  practice the read is asynchronous.
- **Recommended Fix:** Defer the revoke — `setTimeout(() => URL.revokeObjectURL(href), 0)`, or a
  longer delay for large files.
- **Risk / Regression Notes:** None. The blob is small and short-lived either way; deferring by one
  tick does not leak meaningfully.
- **Out of Scope:** No.

### `sanitizeFilename` does not guard Windows reserved names

- **ID:** P31
- **Severity:** Nit
- **Category:** correctness
- **Evidence:** `src/lib/intertext/export.ts` -> `sanitizeFilename` — strips `<>:"/\|?*` plus C0
  control characters and trims trailing dots and spaces, but does not consider reserved device
  names, so a video titled `CON` or `NUL` produces `CON.txt`.
- **User Impact:** Windows refuses to create the file; the download silently fails. Rare, but the
  failure mode is indistinguishable from P30.
- **Root Cause:** The sanitizer handles the illegal-character rule and not the reserved-name rule.
- **Recommended Fix:** After the existing normalisation, prefix an underscore when the base matches
  `/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i`.
- **Risk / Regression Notes:** None; the check is on the whole base, so ordinary titles containing
  those substrings are unaffected.
- **Out of Scope:** No.

---

## B.4 — State, storage and server functions

### `loadJobs` does not apply `withJobDefaults`, so migrated v1 jobs stay malformed

- **ID:** P32
- **Severity:** Medium
- **Category:** correctness
- **Evidence:** `src/lib/intertext/storage.ts` -> `loadJobs` — reads `intertext.jobs.v2` **or** the
  legacy `intertext.jobs.v1` key, filters with the shallow `isJob`, and returns.
  `withJobDefaults` — which supplies `summaryKind` and `summary` — is called only from `saveJobs`
  and `upsertJob`.
- **User Impact:** A job written before `summaryKind` / `summary` existed comes back with those
  fields `undefined`. `ResultPane` then renders `summaryKindLabel(undefined)`, so the badge reads
  "General" for what was an interview, and an `undefined` `job.summary` skips the summary section
  with no explanation. `workspace.tsx` -> `reopen` papers over one field with
  `next.summaryKind || "interview"`, but the loaded `Job` object itself remains wrong everywhere
  else it is used.
- **Root Cause:** The v1 → v2 migration reads the old key but never normalises the payload, so the
  schema version is upgraded in name only.
- **Recommended Fix:** `return parsed.filter(isJob).map(withJobDefaults).slice(0, LIMIT);` and
  write the normalised list back under the v2 key so the migration completes once rather than on
  every load.
- **Risk / Regression Notes:** None. `withJobDefaults` is already defensive (it string-checks
  `summary` and validates `summaryKind` via `isSummaryKind`), so it is safe on untrusted shapes.
- **Out of Scope:** No.

### Transcripts persist in `localStorage` with no way to delete them

- **ID:** P33
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/components/intertext/workspace.tsx` -> the "Recent" `<section>` renders each
  job as a single `reopen` button; there is no per-row delete and no "Clear history" control.
  `src/lib/intertext/storage.ts` exposes `loadJobs`, `saveJobs` and `upsertJob` — no remove path.
- **User Impact:** Up to 10 full transcripts, including speaker labels and summaries, remain in the
  browser indefinitely on whatever machine ran the extraction. On a shared or borrowed computer
  they are visible to the next person. The README leans on "Nothing is stored on a server" as the
  privacy story while saying nothing about clearing what *is* stored locally.
- **Root Cause:** The history feature was built append-only; deletion was never part of the
  storage API.
- **Recommended Fix:** Add a `removeJob(jobs, videoId, language)` helper to `storage.ts` and wire
  two controls in `workspace.tsx`: a per-row remove button and a "Clear recent" action calling
  `saveJobs([])`. Mention local storage in the footer text.
- **Risk / Regression Notes:** The per-row control sits inside the existing full-width `reopen`
  button — nest it as a sibling rather than a child so the click targets do not overlap, and keep
  both at the 44px minimum the rest of the UI observes.
- **Out of Scope:** No.

### Concurrent tabs silently clobber each other's history

- **ID:** P34
- **Severity:** Low
- **Category:** correctness
- **Evidence:** `src/lib/intertext/storage.ts` -> `upsertJob` computes the next list from the
  **in-memory** `jobs` array passed by the caller rather than re-reading storage.
  `src/components/intertext/workspace.tsx` loads once in a mount `useEffect` and never subscribes
  to `storage` events.
- **User Impact:** With two tabs open, each extracting a video, the second write drops the first
  tab's job — the user loses history they can see in the other tab.
- **Root Cause:** The React state is treated as the source of truth for a store that is shared
  across tabs.
- **Recommended Fix:** Re-read inside `upsertJob` (`const current = loadJobs()`) and merge against
  that, and add a `window.addEventListener("storage", …)` in `workspace.tsx` to refresh `jobs`
  when another tab writes.
- **Risk / Regression Notes:** The `storage` event does not fire in the originating tab, so no
  feedback loop. Guard the listener with the key name so unrelated writes are ignored.
- **Out of Scope:** No.

### `isJob` validation is shallow enough to crash the page

- **ID:** P35
- **Severity:** Low
- **Category:** reliability
- **Evidence:** `src/lib/intertext/storage.ts` -> `isJob` — checks only that `videoId` and `url`
  are strings and that `segments` and `paragraphs` are arrays. The array *elements* are
  unvalidated, as are `createdAt`, `durationSec` and `language`.
- **User Impact:** Hand-edited, truncated or partially-written storage yields a job whose
  paragraphs lack `text`; `visibleTranscript` and `wordCount` then throw during render, the router
  error component replaces the entire page (P36), and nothing clears the bad entry — so every
  subsequent reload fails identically and the app is bricked for that browser.
- **Root Cause:** The guard validates the container shape but not the contents, while every
  downstream consumer assumes fully-formed elements.
- **Recommended Fix:** Validate element shape in `isJob` — `typeof p.text === "string"` and numeric
  `start` / `duration` for a sampled or full pass — and drop entries that fail rather than
  returning them.
- **Risk / Regression Notes:** None. Note there is **no XSS risk** on this path: React escapes all
  caption text, `HighlightedText` builds elements rather than markup, and no product code passes
  job data to `dangerouslySetInnerHTML`.
- **Out of Scope:** No.

### A render throw replaces the whole page with no recovery path

- **ID:** P36
- **Severity:** Medium
- **Category:** reliability
- **Evidence:** `src/router.tsx` -> `createRouter({ routeTree, defaultErrorComponent: AppErrorComponent })`
  is the only error boundary. `src/routes/index.tsx` declares no `errorComponent`, and
  `src/lib/error-component.tsx` -> `AppErrorComponent` renders a full-screen "Could not load
  INTERTEXT" with the message text and **no reset button** — its copy says "Try reloading the
  page" but offers no control to do so.
- **User Impact:** A throw anywhere in the transcript render — reachable from P35's corrupt storage
  — takes down the entire application, not just the result pane. The user loses the input form, the
  recent list and the theme toggle, and because the bad data is still in `localStorage` a reload
  reproduces the crash. The stated remedy is the one thing that does not work.
- **Root Cause:** Error-boundary granularity matches the route, not the risky subtree. The result
  pane renders untrusted, deserialized data and is the only part that realistically throws, but it
  shares a boundary with the whole page.
- **Recommended Fix:** Add an `errorComponent` to the index route, or wrap `<ResultPane>` in a
  local boundary, so a transcript render failure degrades to an inline message with the rest of the
  workspace intact. Add a reset action to `AppErrorComponent` (`router.invalidate()` or a reload
  button) so its own copy is actionable.
- **Risk / Regression Notes:** Keep the top-level `defaultErrorComponent` as the last resort; the
  new boundary should be additional, not a replacement. Do not swallow errors silently — the
  inline message must still surface what failed.
- **Out of Scope:** No.

### `client-extract.ts` calls the server function directly in its default argument

- **ID:** P37
- **Severity:** Low
- **Category:** maintainability
- **Evidence:** `src/lib/intertext/client-extract.ts` -> `extractCaptions` —
  `serverExtract: ServerExtract = (opts) => extractTranscript(opts)`. `workspace.tsx` always passes
  the `useServerFn(extractTranscript)` wrapper, so the default is unused in production, but it
  bypasses the router context that `useServerFn` supplies.
- **User Impact:** None today. The risk is latent: a future caller that omits the argument gets a
  subtly different invocation path — no router context, and error shapes that the surrounding
  `catch` was written against the wrapped form.
- **Root Cause:** The default was added for testability and never marked as such, so it reads like
  a supported call path.
- **Recommended Fix:** Either make `serverExtract` a required parameter, or document the default as
  test-only in a comment directly above it.
- **Risk / Regression Notes:** Making it required changes the exported signature — check for other
  call sites first (there are none in `src/` today).
- **Out of Scope:** No.

---

## B.5 — UI, UX and accessibility

### A throw inside `runExtract` leaves the UI spinning forever

- **ID:** P38
- **Severity:** High
- **Category:** reliability
- **Evidence:** `src/components/intertext/workspace.tsx` -> `runExtract` — the body is wrapped in
  `try { … } finally { window.clearTimeout(turnTimer); }` with **no `catch`**, and the function is
  invoked fire-and-forget as `void runExtract(input, lang, summaryKind)`.
- **User Impact:** Any unexpected throw — `finishJob` / `applySpeakerNames` on a malformed job,
  `upsertJob` against corrupt storage, or a `useServerFn` transport error whose shape the inner
  handler does not cover — rejects the promise with nobody listening. `status` stays
  `"extracting"`, the skeleton spins indefinitely, every control remains `disabled`, and the only
  escape is a page reload. Nothing is shown to the user and nothing is logged in the UI.
- **Root Cause:** `finally` was added for timer cleanup, and the error path was assumed to be fully
  covered by `extractCaptions`'s internal catches — which cover the *network* failures but not
  failures in the post-processing that follows.
- **Recommended Fix:** Add a `catch` before the `finally`:
  ```ts
  } catch (err) {
    setJob(null);
    setError({ code: "network", message: "Extraction failed unexpectedly. Try again.", details: String(err) });
    setStatus("error");
  } finally { … }
  ```
- **Risk / Regression Notes:** None. Reusing the `network` code means the existing error panel and
  status label render it without new branches; the `details` line already exists in the markup.
- **Out of Scope:** No.

### No cancel and no retry

- **ID:** P39
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/components/intertext/workspace.tsx` — the submit button is `disabled={busy}`
  during extraction and no `AbortController` is threaded into `extractCaptions`. The error panel
  renders a CTA only for `error.code === "language_missing"`.
- **User Impact:** An extraction that will take ~114s (P05) cannot be stopped — the user watches a
  spinner with no exit. And after a `network` or `provider_blocked` failure — the two most
  transient codes, and the two whose copy explicitly says "try again" / "Wait a moment and retry" —
  there is no retry button. The user must re-focus the input and resubmit.
- **Root Cause:** The busy state was modelled as a boolean lock rather than as a cancellable
  operation, and the error panel's CTA was built for the one case that needed a parameter change.
- **Recommended Fix:** Hold an `AbortController` in a ref, pass its signal through
  `extractCaptions` into `fetchOk`, render a Cancel button while `busy`, and render a "Try again"
  button for `network` and `provider_blocked` that re-invokes `runExtract` with the same arguments.
- **Risk / Regression Notes:** Threading the signal touches every `fetchOk` call site — do it
  together with the P05 deadline work so the plumbing is added once. Ensure cancel resets `status`
  to `"idle"` rather than `"error"`, so a deliberate cancel does not read as a failure.
- **Out of Scope:** No.

### `SegmentedControl` claims radio semantics without radio keyboard behaviour

- **ID:** P40
- **Severity:** Medium
- **Category:** UX
- **Evidence:** `src/components/intertext/segmented-control.tsx` — renders `role="radiogroup"`
  around `role="radio"` buttons with correct `aria-checked`, but every option is independently
  tabbable (no `tabIndex` management) and there is no `onKeyDown` handler for arrow keys.
- **User Impact:** Screen-reader and keyboard users get a control announced as a radio group that
  does not respond to Arrow keys — the interaction the role promises. Tab walks through all five
  summary-type options instead of entering and exiting the group once. This affects all three
  groups: caption language, summary type, and timestamp mode.
- **Root Cause:** ARIA roles were applied to communicate grouping without the matching interaction
  pattern the roles imply. Correct roles plus wrong keyboard behaviour is worse than neither.
- **Recommended Fix:** Implement roving tabindex (`tabIndex={on ? 0 : -1}`) plus Arrow / Home / End
  handling in the existing `map`. Alternatively drop to plain `<button aria-pressed>` inside a
  toolbar, which is honest about the interaction and needs no arrow keys.
- **Risk / Regression Notes:** None functionally. The component is generic over `T extends string`
  and used in three places — verify all three after the change, particularly the timestamp control
  in `ResultPane` which passes `itemClassName`.
- **Out of Scope:** No.

### `TranscriptView` is quadratic in the number of paragraphs

- **ID:** P41
- **Severity:** Medium
- **Category:** performance
- **Evidence:** `src/components/intertext/transcript-view.tsx` -> `TranscriptView` — inside the
  render map, `const n = paragraphs.indexOf(paragraph) + 1;` performs a linear identity scan per
  row, and it is computed **unconditionally** even though `n` is only rendered when
  `mode === "srt"`. The `filtered` array is also recomputed on every render rather than memoised.
- **User Impact:** A two-hour interview cleans to well over a thousand paragraphs, so this is on
  the order of a million comparisons per render — and the component re-renders on **every
  keystroke** in the search box, since `query` lives in `ResultPane` state. Typing in search becomes
  visibly laggy, worst on mobile where the app is most likely to be used one-handed.
- **Root Cause:** Index recovery after filtering is done by searching for the object rather than
  carrying the index alongside the value through the filter.
- **Recommended Fix:** Map before filtering — `paragraphs.map((paragraph, index) => ({ paragraph,
  index }))` then filter that — and read `item.index`. Wrap the result in `useMemo` keyed on
  `[paragraphs, q]`.
- **Risk / Regression Notes:** None. The React `key` currently uses `${paragraph.start}-${index}`
  where `index` is the *filtered* position; switching to the stable source index actually improves
  reconciliation across searches.
- **Out of Scope:** No.

### Errors are announced politely and never receive focus

- **ID:** P42
- **Severity:** Low
- **Category:** UX
- **Evidence:** `src/components/intertext/workspace.tsx` — the status paragraph carries
  `role="status" aria-live="polite"`, while the error panel below it is a plain `<div>` with no
  `role="alert"`, no `tabIndex` and no focus call when `status` becomes `"error"`.
- **User Impact:** A screen-reader user hears the terse status label ("Error · no public captions")
  but not the actionable message, the `details` line, or the fallback CTA — all of which live in
  the unannounced panel. Focus remains on the submit button, far from the new content.
- **Root Cause:** The live region was placed on the summary line rather than on the content that
  carries the actual information.
- **Recommended Fix:** Add `role="alert"` to the error panel and move focus to it — or to its CTA
  when one is rendered — in an effect keyed on `status`.
- **Risk / Regression Notes:** Avoid stacking two live regions announcing the same event; if the
  panel becomes an alert, consider demoting the status line to `aria-live="off"` while an error is
  displayed.
- **Out of Scope:** No.

### The match count and the filtered transcript disagree

- **ID:** P43
- **Severity:** Low
- **Category:** UX
- **Evidence:** `src/components/intertext/result-pane.tsx` computes
  `hits = countMatches(fullText, query)` over title + summary + transcript, while
  `TranscriptView` filters only `paragraphs`.
- **User Impact:** Searching for a word that appears only in the summary reports "3 matches" and
  then renders "No paragraphs match" — two statements contradicting each other on the same screen.
- **Root Cause:** The counter and the filter read different corpora; `fullText` was chosen because
  it was already memoised for the copy action.
- **Recommended Fix:** Either report the split ("2 in summary · 1 in transcript") or count only
  what the list can show (`paragraphs`), so the number and the rendering describe the same set.
- **Risk / Regression Notes:** None. The summary block separately highlights matches via
  `HighlightedText`, so a summary-only match is still visible even if not counted.
- **Out of Scope:** No.

### The language-fallback CTA re-reads the URL input, which may no longer match

- **ID:** P44
- **Severity:** Low
- **Category:** UX
- **Evidence:** `src/components/intertext/workspace.tsx` — the `language_missing` CTA calls
  `void runExtract(input, next, summaryKind)`, reading the live `input` state rather than the video
  that produced the error.
- **User Impact:** The user gets a `language_missing` error, edits the URL box — or clicks a Recent
  job, which calls `setInput(next.url)` — then presses "Extract Korean instead", and extracts a
  *different* video under an error message about the first one.
- **Root Cause:** The error object carries `fallbackLang` and `availableLanguages` but not the
  `videoId` it describes, so the handler has to re-derive the target from mutable UI state.
- **Recommended Fix:** Store the `videoId` that produced the error in component state alongside
  `error`, and have the CTA re-run against that.
- **Risk / Regression Notes:** None. Clear the stored id whenever `status` leaves `"error"` so a
  stale target cannot be reused.
- **Out of Scope:** No.

---

## B.6 — Security and abuse

### `summarizeTranscript` is an unauthenticated, unmetered model-spend endpoint

- **ID:** P45
- **Severity:** High
- **Category:** security
- **Evidence:** `src/lib/intertext/summarize.ts` -> `summarizeTranscript` — a
  `createServerFn({ method: "POST" })` whose validator only shape-checks and truncates: 800
  paragraphs × 800 characters ≈ **640 KB** of caller-supplied text accepted per request. No auth,
  no rate limit, no per-IP budget. The handler then issues up to 5 chunk calls plus 2 final calls
  to `https://api.x.ai/v1/chat/completions` using the deployer's `XAI_API_KEY`.
- **User Impact:** The deployed app exposes a public endpoint that converts arbitrary POSTed text
  into paid model calls. `paragraphs` need not come from a real transcript — the handler never
  checks — so anyone can use it as a free summarization API against the owner's key until the quota
  is exhausted, at which point every legitimate user silently drops to the fallback summary (and
  therefore into P18).
- **Root Cause:** Server functions in this template are public by default, and because the product
  correctly needs no accounts, nothing was ever put in front of the call.
- **Recommended Fix:** Bind summarization to a real extraction: have the caller send a `videoId`
  plus a short-lived token minted by `extractTranscript`, and verify it before spending. Add a
  per-IP token bucket, and cut the accepted paragraph budget well below 640 KB.
- **Risk / Regression Notes:** Re-deriving paragraphs server-side would mean a second extraction
  and doubled latency — the signed token is the cheaper design. Any rate-limit state must be
  in-memory or in an external store; **do not** write it to the filesystem, which does not persist
  on Vercel.
- **Out of Scope:** No — this is a deployment-blocking cost exposure, not a documented product
  limit.

### `extractTranscript` is an unauthenticated outbound-fetch proxy

- **ID:** P46
- **Severity:** Medium
- **Category:** security
- **Evidence:** `src/lib/intertext/extract.ts` -> `extractTranscript` — the validator correctly
  enforces `isVideoId(input.videoId)` and a valid `LangMode` (which is why there is no user-driven
  SSRF), but there is no rate limit, and one accepted request can trigger up to 7 upstream fetches
  (4 from P06 plus 3 in `loadPlayer`).
- **User Impact:** An attacker can use the deployed app as an anonymising relay to hammer
  youtube-transcript.ai and YouTube from the app's server IP. That IP then gets rate-limited or
  blocked, and every real user sees `provider_blocked` — a denial of service against the app's own
  users. This directly undermines the README's "fair-use, not a bulk scraping API" commitment.
- **Root Cause:** Input validation was treated as sufficient protection; there is no request budget
  per caller.
- **Recommended Fix:** A per-IP token bucket (e.g. 10/min) in front of the server function, plus a
  short in-memory cache keyed by `videoId:lang` so repeat requests for the same video do not
  re-fetch. Fixing P06 cuts the per-request amplification by roughly half on its own.
- **Risk / Regression Notes:** A shared-NAT office could hit the limit — tune the bucket and return
  `provider_blocked` (which already has correct user-facing copy) rather than a raw 429. In-memory
  state resets per serverless instance; that is acceptable for abuse damping and avoids adding a
  datastore to a deliberately stateless app.
- **Out of Scope:** No.

### Verified clean — no secret leakage and no XSS vector

- **ID:** P47
- **Severity:** Nit
- **Category:** security
- **Evidence:** `grep` over `.vercel/output/static/assets/*.js` returns **0** occurrences of
  `api.x.ai`, `XAI_API_KEY`, `better-auth`, `youtubei/v1/player` and `ytInitialPlayerResponse`.
  Only the provider-1 URL reaches the browser, as designed. The single `dangerouslySetInnerHTML` in
  product code (`src/routes/__root.tsx`) injects the static `THEME_BOOT_SCRIPT` constant, never job
  data. `HighlightedText` builds React elements, so caption text is escaped. No `JSON.parse` result
  is spread into an object prototype.
- **User Impact:** None — this entry records a verified-good property so a future change cannot
  silently regress it.
- **Root Cause:** N/A.
- **Recommended Fix:** Add a build-output assertion to the test suite: read
  `.vercel/output/static/assets/*.js` and assert it contains no `api.x.ai`, so a refactor that
  accidentally pulls the summarize module into the client bundle fails a gate.
- **Risk / Regression Notes:** The test must skip gracefully when no build output is present, so it
  does not fail on a fresh clone.
- **Out of Scope:** No.

---

## B.7 — Build gates and repository hygiene

### `.vercel/output/**` is committed and every build dirties the tree

- **ID:** P48
- **Severity:** High
- **Category:** maintainability
- **Evidence:** 36 tracked files under `.vercel/output/`, while `.gitignore` lists only
  `node_modules/`, `.project_id`, `.github_repo`, `.env`, `.env.*`. Running `npm run build` during
  this audit produced:
  ```
   M .vercel/output/functions/__server.func/_ssr/ssr.mjs
   D .vercel/output/functions/__server.func/_tanstack-start-manifest_v-BWsFLYCH.mjs
   M .vercel/output/functions/__server.func/index.mjs
   M .vercel/output/nitro.json
  ?? .vercel/output/functions/__server.func/_tanstack-start-manifest_v-_nwhv88K.mjs
  ```
  (reverted after the audit).
- **User Impact:** Developer-facing. Every build produces content-hash churn and phantom deletions,
  so real source diffs are buried in generated noise — and a stale committed bundle can be deployed
  in place of a fresh build.
- **Root Cause:** Grok's export committed the build output alongside the source, and `.gitignore`
  was never extended to cover it.
- **Recommended Fix:** Add `.vercel/` to `.gitignore` and `git rm -r --cached .vercel`.
- **Risk / Regression Notes:** **Confirm the deploy contract first.** If any pipeline consumes the
  committed prebuilt output rather than running `npm run build`, removing it breaks deployment —
  which the constraints forbid. Verify before deleting.
- **Out of Scope:** No — but blocked on confirming how the app is deployed.

### `package-lock.json` is out of sync with the dependency tree

- **ID:** P49
- **Severity:** Medium
- **Category:** reliability
- **Evidence:** A plain `npm install` against the committed lockfile rewrote it — **+95 / −16**
  lines, adding missing nested entries including `@eslint/eslintrc/node_modules/ajv` and
  `json-schema-traverse`.
- **User Impact:** `npm ci`, which refuses to reconcile a lockfile against `package.json` and is
  the standard CI and deploy install command, is at risk of failing outright. Builds are not
  reproducible from the committed lockfile.
- **Root Cause:** The lockfile was committed from an environment that pruned or only partially
  resolved the tree, so it describes an incomplete graph.
- **Recommended Fix:** Regenerate with a clean `npm install` from an empty `node_modules`, commit
  the result, and verify with `npm ci` in a scratch clone.
- **Risk / Regression Notes:** Regeneration can drift transitive versions — review the diff rather
  than committing it blind. Land this before the P50 dependency removal so the two changes are
  separable.
- **Out of Scope:** No.

### Six tests fail at baseline in the template's PWA plugin suite

- **ID:** P50
- **Severity:** Medium
- **Category:** tests
- **Evidence:** `npm test` reports `# pass 189 # fail 6`. All six are in
  `scripts/grok-pwa-plugin.test.mjs` — tests 89, 101, 107, 109, 110, 113. Test 89 expects
  `property="og:title" content="Hello World"` but the injector emits `content="INTERTEXT"`.
- **User Impact:** Developer-facing — `npm test` is red at baseline, so a genuine regression is
  indistinguishable from known noise, and the suite cannot be used as a gate for Phase 2. **No
  product behaviour is wrong:** the deployed `og:title` should be `INTERTEXT`.
- **Root Cause:** `src/lib/og/site.json` was given `"title": "INTERTEXT"`, and
  `scripts/grok-pwa-shared.mjs` correctly prefers `site.json` over the per-document title. The
  tests predate `site.json` and assume a document-title fallback that no longer applies.
- **Recommended Fix:** Update the six tests to build fixtures with an explicitly absent
  `site.json`, or to assert the `site.json`-wins behaviour, so the suite goes green without
  changing shipped behaviour.
- **Risk / Regression Notes:** Test-only. This is template scaffolding, which the scope constraint
  says to ignore — but it is reported because it directly blocks using `npm test` as a
  verification gate, which Phase 2 requires.
- **Out of Scope:** No, for that reason.

### Four lint errors, three in product code

- **ID:** P51
- **Severity:** Medium
- **Category:** maintainability
- **Evidence:** `npm run lint`:
  ```
  src/lib/app-data/client.server.ts   281:13  error  Empty block statement                     no-empty
  src/lib/intertext/clean.ts           48:19  error  Unnecessary escape character: \[           no-useless-escape
  src/lib/intertext/export.ts           7:14  error  Unexpected control character(s) in regex   no-control-regex
  src/lib/intertext/summarize.ts       56:19  error  Unnecessary escape character: \[           no-useless-escape
  ```
  plus 2 warnings.
- **User Impact:** Developer-facing; `npm run lint` cannot be used as a Phase 2 gate.
- **Root Cause:** `clean.ts:48` and `summarize.ts:56` share the same offender — the `[\[(]`
  alternation in the bracketed-noise stripper, where the backslash is redundant inside a character
  class. `export.ts:7`'s control-character range is **intentional and correct** (stripping C0
  characters from filenames is exactly right) and the rule is simply wrong here.
  `client.server.ts:281` is dead template code (P52).
- **Recommended Fix:** Rewrite the two character classes as `[[(]`. Add a scoped
  `// eslint-disable-next-line no-control-regex` above `export.ts:7` with a comment explaining the
  intent. Leave `client.server.ts` to the P52 removal.
- **Risk / Regression Notes:** The two regexes strip noise tokens (`[음악]`, `(applause)`) during
  cleaning — a wrong edit silently changes transcript output. Run `clean.test.ts` after the change
  and diff a real transcript before and after.
- **Out of Scope:** No.

### Auth, database, app-data and multiplayer layers ship in a localStorage-only product

- **ID:** P52
- **Severity:** Medium
- **Category:** maintainability
- **Evidence:** `src/lib/auth/*` (19 files), `src/lib/app-data/*` (10 files),
  `src/lib/multiplayer/*` (2 files), `src/lib/db.ts` and `migrations/auth/0001_auth.sql` — none
  reachable from `src/routes/`, `src/components/` or `src/lib/intertext/` except the passthrough
  `<AuthProvider>` in `__root.tsx`. `package.json` carries `better-auth`, `@electric-sql/pglite`,
  `kysely`, `pg` and `jose`, plus 32 unused UI dependencies. `AGENTS.md` §0.5: "auth and database —
  both are OFF by default."
- **User Impact:** Developer-facing. Install time, `tsc` surface and lint surface all carry code the
  product cannot reach, and `npm test` runs `app-data` and `auth` suites that exercise nothing
  shipped. It also raises the cost of every future security review, which must re-establish from
  scratch that the auth endpoints are genuinely unreachable.
- **Root Cause:** Grok template scaffolding was never pruned after `VITE_AUTH_ENABLED=false` and
  `deploy.database=false` were set.
- **Recommended Fix:** Staged, in its own commit. (1) Drop the 32 unused UI dependencies and
  `migrations/auth/`. (2) Remove `src/lib/multiplayer/`. (3) Remove `src/lib/auth/`,
  `src/lib/app-data/` and `src/lib/db.ts` with their dependencies, replacing `<AuthProvider>` with
  its children. Re-run `npm run check:auth` and `npm run build` after each stage.
- **Risk / Regression Notes:** The template's own tooling — `scripts/check-auth-invariant.mjs`,
  `scripts/browser-smoke.mjs`, and the migration plumbing in `vite.config.ts` — references these
  paths and must be updated in lockstep or the build breaks. Per the scope constraint this is
  **explicitly separate** from the product fixes and should not be mixed into them.
- **Out of Scope:** No, but sequenced last and isolated.

### Stray artefacts and a placeholder package name are committed

- **ID:** P53
- **Severity:** Low
- **Category:** maintainability
- **Evidence:** Tracked `.grok/preview.log` (2,890 bytes of a preview-server run) and
  `.node_modules.lock` (0 bytes); `package.json` declares `"name": "app-builder-workspace"`.
- **User Impact:** Developer-facing noise, and the package name misidentifies the project
  everywhere npm surfaces it.
- **Root Cause:** Export-time artefacts from the Grok sandbox that were never cleaned up.
- **Recommended Fix:** `git rm --cached .grok/preview.log .node_modules.lock`, add both to
  `.gitignore`, and rename the package to `intertext`.
- **Risk / Regression Notes:** Confirm no script keys off `.node_modules.lock` before removing it —
  the zero-byte file looks like a sentinel.
- **Out of Scope:** No.

### The riskiest module has no test coverage

- **ID:** P54
- **Severity:** Medium
- **Category:** tests
- **Evidence:** Tests exist for `parse-url`, `clean`, `export` and `summarize`. There are **none**
  for `src/lib/intertext/providers.ts` (748 lines — the whole waterfall, `parseYtaiMarkdown`,
  `parseJson3`, `parseTimedtextXml`, `classifyPlayability`, the error ranking), none for
  `storage.ts`, and none for `client-extract.ts`.
- **User Impact:** Both Blockers and most of the High findings in this report live in
  `providers.ts`, and not one of them would have been caught by the existing suite. Any Phase 2 fix
  to that file is unverifiable.
- **Root Cause:** The tested modules are the pure, easily-tested ones; the module that performs I/O
  was skipped because it looked network-bound — but its parsers and its ranking logic are pure and
  testable from fixture strings.
- **Recommended Fix:** Table-driven tests over fixtures, no network required — `parseYtaiMarkdown`
  (valid transcript, "transcript unavailable" per reason, a 404 body, an HTML error page),
  `parseJson3` (overlapping chips, newline-only segs, missing `dDurationMs`), `parseTimedtextXml`
  (entities, `<s>` spans), `classifyPlayability` (each code), `runWaterfall`'s error ranking with
  an injected fetch, and a `storage` round-trip plus quota fallback. Several functions
  (`parseYtaiMarkdown`, `parseJson3`, `classifyPlayability`) are module-private and need exporting.
- **Risk / Regression Notes:** None — additive. Add the new files to the `test` script's explicit
  file list in `package.json`, which does not glob `src/`. **This should land before or alongside
  the P01 / P02 / P03 fixes**, not after, so those changes are verified rather than assumed.
- **Out of Scope:** No — highest-leverage item after the Blockers.

### README drift beyond the export table

- **ID:** P55
- **Severity:** Low
- **Category:** maintainability
- **Evidence:** Aggregates P25 (filename suffix), P26 (JSON / Markdown schema) and P27 (Copy
  behaviour). Additionally `README.md` never mentions that the summary depends on `XAI_API_KEY`,
  nor the summary-type selector (General / Meeting / Course / Interview / Podcast) that is the
  second most prominent control in the UI and the input that selects the P18 / P19 code path.
- **User Impact:** A reader cannot predict what the app will produce. In particular, nothing warns
  that choosing "Interview" changes speaker attribution behaviour.
- **Root Cause:** The README was written against an earlier feature set and not revisited as
  summaries and summary types landed.
- **Recommended Fix:** One README pass after the code fixes land, so the document describes shipped
  behaviour rather than intended behaviour.
- **Risk / Regression Notes:** None. Do this **last**, after P25/P26/P27, so it documents the fixed
  behaviour rather than being rewritten twice.
- **Out of Scope:** No.

### `startup.sh` hardcodes `/workspace` and the preview port

- **ID:** P56
- **Severity:** Low
- **Category:** maintainability
- **Evidence:** `startup.sh` runs `cd /workspace`, probes `http://127.0.0.1:8080/`, and logs to
  `/tmp/app-startup.log`. `vite.config.ts` pins 8080 (dev) and 8081 (preview) with
  `strictPort: true`.
- **User Impact:** The script works only inside the Grok sandbox — it fails immediately in this
  checkout, since `/workspace` does not exist, and in any CI or local clone.
- **Root Cause:** Platform scaffolding, correct for its original host and never generalised.
- **Recommended Fix:** Use `cd "$(dirname "$0")"` instead of the absolute path, and read the port
  from `${PORT:-8080}`.
- **Risk / Regression Notes:** **Do not change the Vite host/port.** `vite.config.ts` documents
  `0.0.0.0:8080` as the live-preview contract; changing it breaks the Grok preview. Only the
  `cd /workspace` line is safe to touch.
- **Out of Scope:** Partly — the port pinning is a documented platform contract and is out of
  scope; the `cd` line is not.

---

## Severity roll-up

| Severity | IDs | Count |
| --- | --- | --- |
| Blocker | P01, P18 | 2 |
| High | P02, P03, P05, P19, P20, P38, P45, P48 | 8 |
| Medium | P04, P06, P07, P08, P09, P13, P21, P22, P25, P26, P27, P32, P33, P36, P39, P40, P41, P46, P49, P50, P51, P52, P54 | 23 |
| Low | P10, P11, P12, P15, P16, P17, P23, P24, P28, P29, P30, P34, P35, P37, P42, P43, P44, P53, P55, P56 | 20 |
| Nit | P14, P31, P47 | 3 |

**Total: 56 findings.**

## Proposed Phase 2 sequencing

1. **P54** — fixture tests for `providers.ts`, first, so the extraction fixes are verifiable.
2. **P18 + P20 + P19 + P21** — one coherent change: stop fabricating speaker attribution.
3. **P01 + P02 + P03** — stop presenting non-transcripts as transcripts.
4. **P38 + P36** — no more permanently stuck UI, no more whole-page crash.
5. **P45 + P46** — close the unmetered endpoints before any public deploy.
6. **P05 + P39** — serverless deadline plus the cancel/retry affordance it requires.
7. **P50 + P51 + P49** — make `npm test`, `npm run lint` and `npm ci` green so later work is gated.
8. Remaining Medium and Low findings.
9. **P52** — template pruning, isolated in its own commit, last.

---

*Phase 1 complete. No production code was modified. Awaiting approval before Phase 2.*

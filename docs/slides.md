# Visual extraction architecture and operations

Local MP4 → native video/canvas (video-only FFmpeg fallback) → four-corner ROI → streaming visual detection → chronological review → USD approval → bounded lossless crops → authenticated Responses API → validated blocks/usage → local checkpoints → review/export.

The original video never crosses the application boundary. Ordinary local scanning calls no model, audio processor, speech endpoint, summary, speaker attribution or web search. Native playback is muted; isolation comes from a separate pipeline and tested imports/requests, not muting. Original language/characters/code/table cells remain literal. The server owns a versioned instruction treating embedded slide commands as inert source data; no tool is supplied. Links are exported as text and never followed automatically.

## Browser processing and evidence

`frame-source.ts` feature-detects native decoding by loading metadata/video dimensions and waiting for decoded presentation frames. `requestVideoFrameCallback().mediaTime` supplies actual source timing; seek completion/currentTime fallback is explicitly less precise. No assumed frame-index/FPS timing is used. Native rotation uses displayed dimensions; FFmpeg records reported rotation and autorotates video frames.

The fallback mounts the original File through WORKERFS, selects `0:v:0`, and disables audio/subtitle/data streams with `-an -sn -dn`. It probes one video frame and extracts individual PNG frames with logged PTS. Temporary outputs are deleted, ImageBitmaps closed, and workers terminated on cancellation. It never copies the whole source into MEMFS or transcodes an entire recording. Codec/container metadata is not proof of actual decoder support; unsupported/memory/time-out failures stop with guidance. Source admission remains 1.5 GB/two hours, up to 8192 pixels per dimension / 33 megapixels. These are ceilings, not benchmarks. Browser processing requires an active tab and awake PC.

ROI corners remain normalized original-frame coordinates and timed keyframes. A 24×24 Canvas projective mesh corrects perspective; it is an approximation, not optical enhancement. Original-frame preview and retained coordinates support comparison/correction. Select all edges/footnotes. Uncertain camera movement pauses for region review; correct at the paused source time and resume. Detector images are about 768 px, reduced to a fixed 192×108 comparison grid; full-resolution evidence is separate. Comparisons use exposure compensation, bounded translation alignment, regional differences, stability and low/high thresholds. Tiny changes and unstable candidates can remain as evidence; perceptual similarity never authorizes paid-result reuse. Very brief/blurred content may still be missed.

Every display appearance is retained separately, including A→B→A and text disappearing during builds. First candidate and a stable alternative are retained; sharpness chooses the representative without deleting earlier evidence. Up to three evidence alternatives are supported. Alternative replacement requires source/content confirmation. Navigation group labels can merge/split groups without merging states or source text. Black/unobservable intervals, unstable transitions and reviewer-excluded non-slide intervals are audited. Semantic presenter-only detection is not guaranteed: manually mark exclusions. Dynamic candidate/request safeguards pause and leave the remainder unfinished. No arbitrary candidate is discarded to meet a cost target.

Lossless PNG crops are recursively split with overlapping edges until each is ≤3 MB / 8192 px / 16 megapixels. Image crops preserve coordinates and hashes. Overlap text is not destructively deduplicated; review it with crop provenance. Stored assets have a 128 MB global guardrail, separate from JSON jobs; reaching it stops and asks for explicit cleanup rather than deleting transcripts. Browser decoding/compositing itself can still need significant memory. Browser object URLs, disposable canvases and bitmap/worker resources are released.

## Server configuration and deployment

Only `extraction.server.ts` reads the provider secret. Configuration and extraction use TanStack Start file routes `/api/slides-config` and `/api/slides`. No Next.js settings, runtime file writes, queues or external database are introduced.

| Variable                                            | Default / contract                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                    | Server-only existing key; never `VITE_`                                 |
| `SLIDES_ACCESS_TOKEN`                               | Random 24+ characters; blank falls back to `TRANSCRIPTION_ACCESS_TOKEN` |
| `SLIDES_STANDARD_MODEL`                             | Only `gpt-6.1-sol`                                                      |
| `SLIDES_ECONOMY_MODEL`                              | Only `gpt-6-luna`                                                       |
| `SLIDES_STANDARD_REASONING`                         | `low`; none unsupported by Sol                                          |
| `SLIDES_ECONOMY_REASONING`                          | `none` or `low`                                                         |
| `SLIDES_DETAIL`                                     | `auto` default; optional `high`; `original` rejected                    |
| `SLIDES_MAX_OUTPUT_TOKENS`                          | 4096; 512–8192                                                          |
| `SLIDES_TIMEOUT_MS`                                 | 45000; 1000–50000                                                       |
| `SLIDES_INPUT_USD_PER_M`, `SLIDES_OUTPUT_USD_PER_M` | Optional Standard price overrides, marked operator-supplied             |

Official model pages confirm image input, Responses/structured outputs, and these reasoning settings. The vision guide currently omits Sol/Luna from its model-specific image sizing/multiplier table. Consequently the app uses default `auto`, disables `original`, and makes no Sol/Luna image-token formula claim. `high` is an explicit operator option based on the general image-input contract; model-specific preprocessing and live access remain unverified. Failures do not choose another model. Output limits must include reasoning as well as visible JSON; incomplete/refused/malformed output is retained separately and never marked complete.

The Nitro Vercel preset sets **60-second function duration** through `vercel.functions.maxDuration`, with a ≤50-second provider operation timeout. Verify generated `.vc-config.json` after build and the deployed project's effective limits before use; local production preview is not deployed Vercel testing. Bound the entire incoming multipart stream to 3,500,000 bytes without trusting Content-Length; client serialization measures actual bytes. Only one PNG raster is accepted, with complete signatures/chunks/dimensions and bounded strict metadata. Video/audio/SVG, URL inputs, arbitrary prompts/models, oversize images and cross-origin/invalid-code requests are rejected before dispatch. Provider base64 encoding occurs only on the outbound OpenAI boundary, not browser→Vercel.

No image/text/credential logging is enabled by this feature. Server errors are bounded/non-cacheable. Authentication compares secret hashes safely; same-origin is supplemental. This is owner-only, not public multi-tenant protection. In-memory/browser accounting cannot enforce account-wide budgets: set provider spending controls independently.

## Persistence, billing and privacy

IndexedDB `intertext` upgrades v1→v2, preserving jobs/settings and adding `slideAssets`/`slideLeases`. Explicit `processingMode: slides` prevents visual history reopening as audio. JSON jobs store references/timing/coordinates/raw responses/separate edits/model/prompt/schema versions/usage/attempts; Blobs exist only in the bounded asset store. Legacy v1 backups still import; visual text backups use v2 and omit media/secrets. Images can be evicted/absent after backup import: re-select the original recording and use **Regenerate missing saved evidence**. This local operation updates asset references only if crop coordinates/dimensions and encoded hashes match; different pixels require a deliberately reviewed alternative. It keeps raw responses and manual edits without model calls. A metadata/sample fingerprint plus duration/dimensions checks is convenient, not a whole-file cryptographic proof.

Reuse keys include exact encoded image SHA-256, crop/ROI transformation, model/reasoning/detail/output limit and prompt/schema versions. Loaded assets are hashed again before dispatch. Cache reuse in a job retains each appearance's timestamps; perceptual hashes/title similarity do not deduplicate paid text. Each dispatch intent is saved before the API call; each result is saved before a subsequent call. Failed storage stops further calls. Immutable old responses and edits survive retries; the accepted source stays selected until the reviewer chooses another completed attempt in the comparison. Web Locks plus an atomic expiring IndexedDB lease keyed by the sampled source identity prevent ordinary duplicate tabs, but do not guarantee exactly-once global billing. Lost responses/crashes/accepted aborts may be charged; unknown-billing intent/result requires deliberate retry approval. Only explicitly rejected rate limits receive bounded backoff; quota/auth/schema/model failures do not retry endlessly.

Requests set `store:false`. This does **not** promise zero retention: OpenAI's applicable abuse-monitoring logs can retain content for up to 30 days by default (longer exceptions and separately approved retention controls apply). INTERTEXT stores no permanent server-side conference library. Local text/images remain until explicit deletion, browser clearing or eviction. Text backups should be kept separately.

## Cost contract

Pricing version `2026-10-06-standard-short`, Standard/default service tier, USD per million tokens:

| Model       | Uncached input | Output | Reported cached input | Reported cache write |
| ----------- | -------------: | -----: | --------------------: | -------------------: |
| gpt-6.1-sol |          $2.00 | $10.00 |                 $0.10 |                $2.50 |
| gpt-6-luna  |          $0.10 |  $0.50 |                 $0.01 |               $0.125 |

Rates were checked on 2026-10-06 against official pricing/model pages. No image-generation, per-minute/per-GB or discount price is used. Each bounded call remains in short context; no long-context discount assumption. Actual usage input/output totals drive known cost; reasoning tokens already in output totals are not counted again. Cached/write categories count only if supplied in usage. Unknown-cost reservations and pending estimates remain separate. Provider invoices/taxes/other adjustments may differ.

Planning estimates use dimensions, actual crop count, profile, adjustable input-tokens-per-megapixel heuristic and output allowance. A 25% planning margin is not a provider surcharge nor a guaranteed upper bound. Before dispatch the next estimate is reserved against known cost + unknown reservations. If it exceeds the $5 default job budget, processing pauses for review/raising the budget. Browser controls are operational guardrails, not tamper-proof global caps.

Deterministic hypothetical tests: 96 Sol calls at 3000 input/1000 output cost $1.536 ($1.92 with 25%); 80 Luna + 16 Sol calls cost $0.32 ($0.40); 160 Sol calls at 7000/1500 cost $4.64 ($5.80). The last plan exceeds the default budget and needs review. These examples do not establish recognition equality, an escalation rate, actual image tokens or a successful 1 GB scan.

## Official sources checked

- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/your-data
- https://vercel.com/docs/functions/limitations
- https://ffmpegwasm.netlify.app/docs/faq/
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

No new application dependencies were added. Existing React/Zod/FFmpeg/Playwright/fake-indexeddb seams are reused; the slide workspace is lazy, browser APIs start in client lifecycles, and YouTube-only use does not download video-processing workers/core. Tests run with mocked providers and do not establish OCR quality. See [validation](slides-validation.md).

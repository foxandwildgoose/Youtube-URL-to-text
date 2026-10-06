# Visual extraction validation

Ordinary tests mock paid provider calls. The committed presentation fixture is H.264, 1280×720, 16 seconds, with **no audio stream**. It includes Korean/English, a small footnote/URL, code, table/empty cells, one changed number under an unchanged title, incremental/replaced text, A revisited, a textless diagram and a black interval. `slides-presentation.json` records intended timings; actual boundary brackets remain measured rather than assumed frame-perfect. Regenerate with `node scripts/create-slides-fixture.mjs` (system FFmpeg and Playwright); never call this an OCR benchmark.

## Automated commands

```sh
npm test
npm run typecheck
npm run lint
npm run check:auth
npm run build
npm run test:slides:browser
SLIDES_SMOKE_URL=http://127.0.0.1:8081 npm run test:slides:browser
```

Run browser tests with development/built previews already started. System Chromium can be selected with `PLAYWRIGHT_EXECUTABLE_PATH`. The feature test intercepts paid slide calls and external fonts/branding; video decoding, manual ROI/frame comparisons, raster multipart bytes, IndexedDB, review, edit/export/reload and recovery of deliberately removed image assets are real. It checks zero audio/transcription/xAI API requests and no extra provider requests during recovery. Mock text is transport evidence only. The template's full external-resource smoke can remain limited by the cloud Chromium proxy CA trust; do not disable TLS to pass it.

## Explicitly authorized live pilot / model comparison — NOT RUN

1. Configure server key/random access token and provider spend controls. Obtain explicit owner approval for paid calls; ordinary test commands supply no such approval.
2. Select 1–3 representative states: mixed Korean/English, small footnotes, changed table cell, dense code/notation. Keep the original frames and manually transcribe a literal reference, including visible mistakes/empty cells.
3. Record model ID, reasoning, image detail, output limit, exact crop dimensions/hash/ROI, prompt/schema/pricing versions, and service tier. Start Standard with the explicit estimate approval.
4. Compare literal characters and ordered blocks. Record character errors (including spaces/code indentation), omitted blocks/cells/footnotes, invented text, unreadable spans, and reviewer observations. A model's self-reported flags are not calibrated accuracy.
5. If comparing Economy, deliberately select that profile and approve another paid run of the same exact evidence. Compare errors and tokens/cost. Keep both immutable attempts and manual edits. Do not recommend Economy as equally accurate without these measurements; no automatic Standard escalation is implemented.
6. Record available input/output/reasoning/cached usage, request IDs, outcome, retries and unknown cost separately. Do not double-count reasoning tokens. Provider invoices may differ from estimates. Retain the pilot checkpoints so returning to the same profile/content reuses them.

## Real Windows desktop 1 GB / 40-minute recording — NOT RUN

1. Record Windows version, CPU/GPU/RAM/free disk, desktop browser/version, source codec (H.264/HEVC), byte size/duration/resolution/rotation and recording quality. Use an actual conference recording, not a tiny fixture or synthetic large File.
2. Configure server credentials and owner-only spending controls. Open Network and browser task manager. Use **MP4 TO TEXT** and confirm the source MP4 is not uploaded; an audio-less source must also work. Select/correct the slide region and perspective, including footnotes/edges.
3. Scan locally with recorded sample rate/detection width/sensitivity/stability/refinement settings. Record elapsed time, available/peak memory if measurable, bounded working-frame counts, evidence bytes and asset limit. At 2 Hz expect roughly 4800 local comparisons, not that many model calls.
4. Review the entire chronological gallery against the recording. Count actual/detected/missed appearances, A→B→A, disappearing/changed animations, small numeric/code changes, textless states and black/presenter-only gaps. Record boundary brackets and manually measured boundary error. Insert missed states and mark non-slide exclusions; do not treat milliseconds as guaranteed precision.
5. Test camera movement, flicker/fades and occlusion. At region-review pauses, capture the preview at that source time, apply a corrected ROI keyframe and resume. Candidate explosion must leave the remainder visibly unfinished. Record every safeguard pause rather than calling it completion.
6. Approve a small paid pilot only with owner permission; evaluate as above. Choose a profile/output allowance/budget, review planned crops/counts/dimensions and approve remaining selected states. Record expected requests, image bytes and token heuristic assumption separately from actual usage.
7. Verify sequential binary PNG requests only: each audio-free image ≤3 MB, **complete multipart ≤3,500,000 bytes**. Record per-call maximum body, total uploaded image bytes, API calls, request IDs, usage and costs. No full video/audio/summary/web-search calls may occur.
8. After some states complete, pause/cancel/reload. Reopen the visual history item. Reject a different source (metadata/fingerprint/duration/dimensions) and re-select the original. Resume without retransmitting complete same-contract crops. Test duplicate tabs, lost responses/unknown-billing deliberate approval, quota exhaustion and output-token incompletion.
9. Compare all completed literal text with images. Review small Korean glyphs, case/punctuation, units, empty table cells, code indentation and formulas. Flag unreadable source; never repair it from speech. Preserve earlier disappearing text and state provenance. Check overlap crops without deleting legitimate repeated words.
10. Edit text, reopen/search history, adjust boundaries/groups and use alternatives only after same-state confirmation. Retry one state/crop with explicit approval; edits and earlier raw attempts must remain. Missing/evicted image assets require source re-selection/regeneration, not invention.
11. Export TXT with Windows BOM, Markdown and JSON. Verify Unicode/code/tables/edits/titleless/textless labels and timing metadata. Export an INTERTEXT text backup; import into a separate profile with existing audio/YouTube history. No image/MP4/secret may be in that JSON. Re-select source for evidence recovery.
12. Record pass/fail, elapsed local scan/extraction time, memory observations, buffered/evidence frame counts, candidates/missed states, image bytes/max request, token categories, retries/unknown attempts, known/pending costs and manually reviewed omissions. This recording is validated only after successful completion and manual source review.

Limits: browser CPU/memory/codec support, approximate perspective mesh and detection, transient content between samples, unclear/low-resolution source, manual ROI/non-slide correction, open-tab processing, eviction/quota/private browsing, estimated boundaries, model errors and API charges. No cloud background worker, durable global request deduplication or account-wide budget is claimed.

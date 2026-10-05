# INTERTEXT media workspace implementation

## Architecture

The existing React/TanStack Start app now has two acquisition paths. YouTube still uses the original public-caption provider waterfall. Local media uses:

```text
one local MP4
→ worker-mounted File (WORKERFS)
→ audio-only mono 24 kHz / 48 kbps MP3 sections
→ silence-aware core boundaries with three-second prefix/suffix buffers
→ actual encoded-size checks and automatic subdivision
→ one small, measured multipart request through Vercel at a time
→ server-authorized OpenAI gpt-transcribe
→ each raw completed transcript checkpointed in IndexedDB
→ deterministic conservative boundary merge
→ one editable transcript
```

No full original video or video frames go to Vercel or OpenAI. There is no complete-file ArrayBuffer read or full intermediate MP3. Small compressed section buffers and worker filesystem artifacts are released; workers terminate on completion/cancellation and object URLs are revoked when selection changes.

Known overlapping audio is insurance against cuts in the middle of speech. Merge matching uses only adjacent suffix/prefix windows, bounded characters and words, actual overlap timing, meaningful minimum lengths, conservative thresholds, and extra fuzzy anchors. Uncertain text remains. There is no global repetition removal or extra paid LLM merge. Raw checkpoints and boundary audit metadata are retained, with manual edits stored separately and reapplied during resume.

## Important files

- `src/lib/intertext/types.ts`, `media-types.ts`: generic source/job/checkpoint contracts, without fake YouTube IDs for uploads.
- `media-config.ts`, `media-inspect.ts`, `media-processor.ts`, `media-chunks.ts`, `media-merge.ts`, `media-errors.ts`, `upload-pipeline.ts`: local inspection/fingerprinting, worker processing, boundary planning, size enforcement, sequential retries/resume/cancellation and merging.
- `transcription-contract.ts`, `transcription-client.ts`, `transcription.server.ts`, `src/routes/api/transcription.ts`, `src/routes/api/transcription-config.ts`: measured multipart requests, provider adapter, server authorization/validation and missing-configuration guidance.
- `storage.ts`: IndexedDB persistence, legacy migration, upload settings, raw checkpoints, edits, validated atomic backup import/export.
- `workspace.tsx`, `upload-workspace.tsx`, `result-pane.tsx`, `transcript-view.tsx`: source modes, file selection/playback, real stage/count progress, history/resume, optional summary, editing/search and export controls.
- `export.ts`: edited-text export, VTT/CSV and print/PDF with safe metadata and CSV/HTML escaping.
- `scripts/prepare-media.mjs`: self-hosted FFmpeg core asset preparation; generated binaries stay ignored.
- `scripts/media-browser-smoke.mjs`, `tests/fixtures/local-media.mp4`: optional real browser/local-processing check with mocked provider responses; fixture is a generated 12-second tone/video, not private media or a recognition benchmark.
- `.env.example`, `README.md`, `docs/transcription-api.md`, `docs/large-file-validation.md`: server settings, verified official contracts, workflow and real recording validation.

Existing template test isolation and baseline lint defects were fixed without removing tests or disabling checks. Generated build artifacts were excluded from the source change.

## Dependencies and storage

Added `@ffmpeg/ffmpeg` (worker bridge), `@ffmpeg/core` (single-thread local audio processing), and development-only `fake-indexeddb` (realistic transaction/migration tests). The application continues using its existing framework, theme, Radix controls, and optional summary implementation.

**No paid external database is required.** IndexedDB stores transcript history, checkpoints, summaries, edits, and reusable settings. Legacy v1/v2 localStorage jobs migrate with committed receipts, preventing repeated import or resurrection of deleted jobs when legacy cleanup fails. Backups contain JSON data only, never the original media binary. Storage/quota failures are surfaced and never silently truncate older history.

## API secrets and cost controls

`OPENAI_API_KEY` is read only in `transcription.server.ts`, then used for the outgoing authorization header to the fixed OpenAI transcription endpoint. It is absent from client environment variables, HTML, logs, responses, and backups. Static build assets contain neither the OpenAI provider URL nor a client-side `process.env.OPENAI_API_KEY` read.

`OPENAI_TRANSCRIPTION_MODEL` defaults centrally to the documented `gpt-transcribe`. Native `languages[]=ko`, `languages[]=en`, `keywords[]`, conference prompt, and the final 400 characters of previous context are used. Before sending, the client measures the exact serialized multipart body; the server independently bounds it before parsing. Audio is capped at 3 MB; total multipart at 3.5 MB.

The personal deployment requires a random 24+ character `TRANSCRIPTION_ACCESS_TOKEN` in addition to the API key. Same-origin requests and a constant-time access-code comparison protect the API account while keeping accounts/database integration off. The entered code stays in browser memory only. Configuration is checked before local processing; missing keys leave the application usable. Duplicate Start clicks are locked synchronously. Transient failures receive bounded retries; auth/permanent input errors do not.

## Actual validation

| Check                                 | Result                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                            | Passed: 196 script tests + 158 TypeScript tests = **354 tests**, none skipped or failed. Provider calls mocked.                                                                                                                                                                                                    |
| `npm run typecheck`                   | Passed.                                                                                                                                                                                                                                                                                                            |
| `npm run lint`                        | Passed without errors or warnings.                                                                                                                                                                                                                                                                                 |
| `npm run build`                       | Passed, including self-hosted FFmpeg assets and Vercel output. No database configured or required.                                                                                                                                                                                                                 |
| Development upload browser test       | Passed: real tiny MP4 metadata/local playback, missing-key guidance, actual worker extraction, measured request, mocked transcription, IndexedDB, one result, duplicate-Start protection, mobile overflow/page-error checks.                                                                                       |
| Production upload browser test        | Same flow passed against the built preview, with mocked API calls.                                                                                                                                                                                                                                                 |
| Result browser tests                  | Passed: real local WAV playback, Enter-key timestamp seek, text edit, global speaker rename, search, reload persistence, TXT/SRT/VTT/Markdown/JSON/CSV downloads using edited text, print/PDF layout, light/dark dialog, Escape closure, mobile overflow.                                                          |
| Synthetic 610-second MP4 worker check | Passed. Source 3,744,337 bytes; detected silence around 297.8/598.0 seconds; output sections 1,805,565 / 1,837,821 / 90,381 bytes; adjacent audio overlap six seconds; decoded durations matched planned ranges within 0.1 ms. This is a processing check, not a real conference recognition/large-file benchmark. |
| Worker cancellation                   | Passed; in-flight synthetic encoding cancelled and worker terminated in approximately 25 ms.                                                                                                                                                                                                                       |
| Standard dev/built browser smoke      | Both rendered equal desktop/mobile content, with no application page errors or horizontal overflow; runner exits nonzero due external fonts/branding TLS certificate errors in the cloud browser. Feature checks explicitly stubbed those external resources.                                                      |
| Paid OpenAI integration               | **Not run**; actual credentials absent. No API credits consumed.                                                                                                                                                                                                                                                   |
| Real 1 GB / 40-minute GoPro recording | **Not run**; no suitable recording supplied. Exact procedure in `docs/large-file-validation.md`.                                                                                                                                                                                                                   |

Automatic approval review rejected importing the cloud proxy CA into Chromium's persistent trust store because it would broaden TLS trust beyond the authorized task. TLS verification was not disabled and the rejection was not bypassed. Full external-resource smoke validation remains an environment limitation.

## Manual verification and limitations

Follow [the real-recording checklist](large-file-validation.md): configure server credentials/code, drop a representative recording, choose Korean + English and AI Conference, start, check request sizes/memory, cancel/reload/re-select/resume, listen around every saved boundary, correct text, and validate persistence/export/backup.

Browser CPU/memory and FFmpeg decode/encode overhead remain practical limits. WORKERFS reduces avoidable copies; it does not eliminate codec/WASM memory. The 1.5 GB/two-hour admission limits are ceilings rather than a guarantee. Keep the tab open; incomplete work stops when it closes, while completed checkpoints can resume after re-selecting the original file. Browser storage can be evicted or cleared: export backups. Timestamps are explicitly chunk-estimated, speech recognition is fallible, and low-confidence duplicates may remain to avoid losing speech. OpenAI usage incurs API charges separate from ChatGPT. DOCX was optional and is not implemented; six downloadable formats and print/PDF are available.

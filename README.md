# INTERTEXT

Audio, video & YouTube → readable text. A personal media transcription workspace built on the existing React / TanStack Start application.

## One GoPro recording → one transcript

1. Open **Upload File** and drop your MP4, or choose **Browse Files**.
2. Choose **Korean + English** and **AI Conference**.
3. Under **Advanced options**, keep only relevant technical terms and enter your personal workspace access code.
4. Choose **Start transcription** and keep the tab open.
5. Review the complete transcript, seek the local recording, correct text or speaker labels, and export.
6. Generate a summary separately when wanted. A summary failure does not remove the transcript.

You do not need to convert MP4 to MP3 or split the recording. YouTube mode continues to read public captions through the existing provider waterfall; it never downloads YouTube audio or sends YouTube videos through speech transcription.

## Local processing and safe requests

Upload processing loads FFmpeg only when needed. Its worker mounts the original `File` using **WORKERFS**, rather than reading the whole video into an `ArrayBuffer` and copying it into an in-memory filesystem. It extracts only the audio stream into mono, 24 kHz, approximately 48 kbps MP3 sections. No video frames are sent to OpenAI.

Cuts target about five minutes, search nearby silence, and retain three seconds on each side. Actual encoded size is checked before requests; oversized sections are subdivided automatically. Encoded audio is limited to 3 MB and the complete multipart request to 3.5 MB, below Vercel's 4.5 MB request limit. The original MP4 never goes through a Vercel Function. Requests run sequentially and include a short previous-transcript context.

Adjacent overlapping sections are merged locally. Exact/normalized/fuzzy matching examines only the prior suffix and next prefix near a known audio overlap, with minimum-length and confidence requirements. Uncertain matches retain both texts. Intentional repetition elsewhere stays intact. Raw completed section transcripts and merge audit metadata remain available in the job backup, so merging can be improved without paying to transcribe again.

## Setup

Use a recent Node version (Node 24.19.0 was validated). From the repository:

```sh
npm ci --legacy-peer-deps
npm run dev
```

`predev` and `prebuild` copy the installed single-thread FFmpeg core assets to `public/ffmpeg/`. These generated assets are not committed. Vite bundles the FFmpeg worker. The core is self-hosted: no CDN dependency or cross-origin isolation requirement for the single-thread build. YouTube-only sessions do not download the core.

For file transcription, configure these **server-only** variables in the hosting provider's environment settings; `.env.example` contains empty placeholders:

```text
OPENAI_API_KEY
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
TRANSCRIPTION_ACCESS_TOKEN
```

Set the access token to a random secret of at least 24 characters. Enter the same personal access code in Upload File → Advanced options; it is held in memory for that session, not stored with transcripts. The endpoint requires it and checks request origin to prevent a public visitor from spending your API quota. This personal-use protection does not introduce accounts or a database. If sharing the deployment, provision appropriate authentication and spending controls first.

The API key is read only in the server adapter and sent only to OpenAI. Never set a `VITE_` API-key variable. Without the key or personal access token, the app still boots: YouTube captions, file selection, local playback, history, and exports remain available; starting transcription shows configuration guidance.

OpenAI API billing is separate from a ChatGPT subscription. No paid API requests run in ordinary tests. Optional summaries reuse the existing xAI integration (`XAI_API_KEY`) or its extractive fallback.

## Official API constraints

Verified against the current official documentation during implementation:

- [OpenAI speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text): `gpt-transcribe`, multilingual `languages` hints, `keywords`, contextual `prompt`, and up to 25 MB audio input.
- [OpenAI transcription API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create): supported multipart fields and response contract.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations): 4.5 MB request/response body limit. INTERTEXT deliberately uses smaller requests.
- [FFmpeg.wasm API](https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/FFmpeg/) and [FAQ](https://ffmpegwasm.netlify.app/docs/faq/): worker execution, WORKERFS mount support, substantial CPU/memory overhead, and a 2 GB input constraint. Admission limits are not a guarantee of browser memory capacity.

The primary path uses complete per-section JSON responses, not a live-stream transcription UI. Approximate timestamps come from the known audio section positions; they are labeled **chunk-estimated**, not word-level precision.

## Local history, resume, and backup

No paid external database is required. IndexedDB stores job metadata, settings, completed transcription checkpoints, raw section text, final transcripts, summaries, and edits. Only small preferences use localStorage. Existing `intertext.jobs.v1` and `intertext.jobs.v2` history is migrated idempotently without discarding source metadata.

Cancel stops local work and further network requests; already completed sections remain saved. To resume after a reload, reopen an unfinished recording and re-select the original file. A sampled fingerprint verifies the recording; completed sections are reused. The browser does not retain the original media binary in the job database.

History supports reopen, rename, delete, and search. Use **Export INTERTEXT Backup** regularly; JSON backups include jobs, checkpoints, edits, and settings, but no media binaries or API secrets. **Import INTERTEXT Backup** validates and merges records. Browser storage is not cloud backup and may be cleared, evicted, unavailable in private browsing, or exhausted; failures are surfaced rather than silently dropping old history.

## Review and export

The native video/audio player uses a temporary object URL for the local file. Timestamp buttons seek that recording; re-select the original file for playback after reopening a saved job. Edits save to IndexedDB and are used by search and exports; raw provider checkpoints stay unchanged.

TXT, SRT, VTT, Markdown, JSON, and CSV exports are available with timestamp, speaker, and summary options where the format allows. TXT can include a UTF-8 BOM for Windows. **Print / Save as PDF** uses the browser print layout. Subtitle exports reflect corrected transcript text. File transcription timing remains approximate.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Unit tests mock transcription and cover silence/fixed boundary planning, overlap, byte-limit subdivision, exact/fuzzy/uncertain merge behavior, resume, cancellation, storage migration, backup validation, server request authorization, and safe exports. The optional `npm run test:media:browser` exercises an actual tiny MP4 → local FFmpeg → mocked transcription → IndexedDB → result flow. Start the development server first and install Playwright Chromium, or set `PLAYWRIGHT_EXECUTABLE_PATH` to your existing Chromium binary. `MEDIA_SMOKE_URL` can target the built preview. Its API calls are intercepted and never consume credits; it deliberately stubs external font/branding assets to isolate application behavior.

See `docs/large-file-validation.md` for the required real recording validation. The committed 12-second test fixture contains a generated tone, not private recordings or real speech; it verifies processing, not recognition quality.

## Practical limits

The target is a roughly 1 GB, 40-minute Korean-English GoPro recording. The input admission limits are 1.5 GB and two hours; these are safety ceilings, **not a claim that a real 1 GB GoPro recording has been validated**. That recording was not available in this workspace. Worker mounting reduces avoidable copies, but FFmpeg still needs decoder/encoder/WASM memory and can be slow, especially on mobile. Memory failures produce a clear retry/fallback message. Use a recent desktop browser for long recordings.

Keep the tab open while processing. Completed sections survive reload when IndexedDB is available, but unfinished local work stops. Speech recognition can mishear names, mixed-language speech, crowd noise, and technical vocabulary; review the transcript. Low-confidence overlap duplicates may remain to protect real speech. Lyrics recognition is experimental.

Uploaded media is processed locally where practical. Small audio segments are sent securely to OpenAI. INTERTEXT does not maintain a permanent server-side media library. Transcript history is local to this browser.

## YouTube caption limits

Only publicly accessible captions are read. Private, members-only, many age-restricted videos, captionless recordings, and live streams without stable replay captions may fail. Cloud IPs can be bot-checked. The first provider is [youtube-transcript.ai](https://youtube-transcript.ai/youtube-transcript-api), followed by YouTube Innertube/watch-page caption discovery and timedtext. Auto prefers Korean and then English; explicit language choices require that track. When unavailable, the app explains how to copy the transcript from YouTube rather than downloading audio.

Personal research use; respect recording consent and copyright when sharing transcripts.

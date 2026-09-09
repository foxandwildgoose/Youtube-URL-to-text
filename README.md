# INTERTEXT

A single-purpose tool that turns a public YouTube interview URL into downloadable UTF-8 text.

Paste a `youtube.com/watch`, `youtu.be`, Shorts, live replay, embed, or raw 11-character video ID. INTERTEXT reads the public caption track, cleans auto-caption chips into readable interview paragraphs, and lets you copy or download TXT, SRT, Markdown, and JSON. Nothing is stored on a server — recent jobs stay in this browser’s `localStorage`.

## Caption provider waterfall

Browser pages cannot reliably call YouTube `timedtext` themselves (CORS and bot checks). INTERTEXT tries providers in order and shows which one succeeded.

1. **[youtube-transcript.ai](https://youtube-transcript.ai/youtube-transcript-api)**  
   `GET https://youtube-transcript.ai/transcript/{VIDEO_ID}.txt?lang={LANG}`  
   CORS-open Markdown/UTF-8. Tried first from the browser (your IP), then again from the app server if needed. Language order in Auto: `ko` → `en` → unspecified.

2. **YouTube timedtext JSON (`json3`)**  
   If provider 1 fails, the server asks YouTube’s Innertube player (and, if needed, the watch page’s `ytInitialPlayerResponse`) for caption tracks, then fetches `fmt=json3` segments (`events[].segs[].utf8` with `tStartMs` / `dDurationMs`). No API key.

If every provider fails, the UI explains what to do next: on YouTube use **More → Show transcript → copy**, or locally `yt-dlp --write-subs --skip-download URL`.

## Language policy

- **Auto** (default): prefer manual captions over ASR; prefer Korean, then English, then the first available track.
- **Korean (`ko`)** / **English (`en`)**: require that language. If it is missing, INTERTEXT offers a fallback track instead of a generic error.
- Korean is always handled as UTF-8. Windows-friendly TXT downloads can include a UTF-8 BOM so Notepad does not mojibake Hangul.

## Known YouTube caption limits

- Only **public** caption tracks. Private, unlisted-without-captions, members-only, and many age-restricted videos will fail.
- A video with **no captions** (and no auto-captions) cannot be transcribed in v1. This app does not download audio or run Whisper.
- Live streams often have no stable transcript until the replay exists.
- Auto-generated captions are rolling windows of chips, not sentences. INTERTEXT merges overlaps and groups ~8–20s interview paragraphs; it does not invent speaker names.
- Timedtext from cloud IPs is frequently bot-checked (empty body / PO token). That is why provider 1 exists, and why a blocked response is not reported as “something went wrong.”
- Provider 1 caches on the edge for about 24 hours and is fair-use, not a bulk scraping API.

## Exports

All files are generated in the browser.

| File | Contents |
| --- | --- |
| TXT | Clean paragraphs, UTF-8, optional BOM |
| SRT | Numbered cues with `start --> end` |
| Markdown | Title, source URL, language, transcript |
| JSON | `{ videoId, url, language, sourceType, segments[] }` |

Filenames: `{sanitizedTitle-or-videoId}_{lang}.{ext}`. Copy copies the visible transcript, not JSON.

## Legal

Personal research use only; do not republish copyrighted interviews; this app reads public captions, it does not download the video.

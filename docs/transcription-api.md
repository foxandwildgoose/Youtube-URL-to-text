# Transcription API contract

Official documentation checked on October 5, 2026. These are documented API
capabilities, not results of a paid transcription or a quality benchmark.

| Requirement           | Verified official contract                                                                                                                                     | Implementation                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorded speech model | The speech guide recommends `gpt-transcribe` for recorded speech in its original language.                                                                     | One centralized default; server override `OPENAI_TRANSCRIPTION_MODEL`.                                                                                                                                              |
| Mixed languages       | `gpt-transcribe` accepts `languages`, an array of ISO-639-1 codes.                                                                                             | Multipart `languages[]=ko` and `languages[]=en`; no forced single language in mixed or automatic mode.                                                                                                              |
| Vocabulary            | `keywords` is an array of words/phrases supported by `gpt-transcribe`.                                                                                         | Multipart `keywords[]`; bounded, editable vocabulary.                                                                                                                                                               |
| Continuity            | `prompt` guides transcription style or continues an earlier audio segment.                                                                                     | Conference context, custom prompt, and only the prior transcript's final 400 characters.                                                                                                                            |
| Input size            | OpenAI's guide permits files up to 25 MB. Vercel permits a 4.5 MB request or response.                                                                         | Audio blob up to 3,000,000 bytes; the browser serializes and measures the entire multipart body before sending, capped at 3,500,000 bytes. The server independently checks the body while streaming before parsing. |
| Formats               | The guide lists MP3, MP4, MPEG, MPGA, M4A, WAV and WebM. The API reference also includes FLAC and OGG.                                                         | The local processor generates audio-only MP3; endpoint accepts bounded supported audio MIME/container signatures. Video MIME is rejected.                                                                           |
| Response              | `gpt-transcribe` returns JSON `text` and optional `languages: [{code: ...}]`.                                                                                  | Only normalized text, language codes and `chunk-estimated` timestamp quality reach the browser. No exact word timestamps are invented.                                                                              |
| Streaming             | File transcription supports `stream=true` with `gpt-transcribe`.                                                                                               | Sequential final JSON responses allow an atomic saved checkpoint before the next section. File streaming and Realtime sessions are unnecessary here.                                                                |
| Deprecations          | The deprecations page announces retirement of `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `gpt-4o-transcribe-diarize` on February 26, 2027. | Default uses the recommended replacement `gpt-transcribe`. Legacy configured models use their documented single-language/prompt contract rather than unsupported native array fields.                               |

Sources:

- [OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI create transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- [Vercel function limitations](https://vercel.com/docs/functions/limitations)

## Personal account authorization

The existing application has accounts and external database usage disabled.
Enabling a public billable upload endpoint would expose the owner's API quota.
The endpoint therefore requires both a same-origin browser request and a
personal access code that matches server-only `TRANSCRIPTION_ACCESS_TOKEN`.
Use a randomly generated code containing at least 24 characters. Keep it out of
source control. The browser holds the entered code in memory for its current
session; it is not included in transcript settings, history, or backup files.
The server compares fixed-length SHA-256 hashes with a constant-time comparison.

`OPENAI_API_KEY` is read only in `transcription.server.ts`. It is used exclusively
as the outgoing Authorization header to the fixed OpenAI transcription URL.
Never prefix either secret with `VITE_`, put either in HTML, or return them from
the configuration endpoint. Missing credentials leave the app usable and return
safe configuration guidance. The `.env.example` contains empty placeholders.

The request body, metadata, model choice, language settings, keywords, prompt,
file MIME and container signature are validated before the provider call. Audio
never goes to disk or a database. Requests abort with browser cancellation and
have a 55-second provider deadline. Provider errors return typed, safe messages
without raw provider response bodies, keys, or personal access codes.

The configuration and adapter tests use mocked fetch responses only. Ordinary
tests never spend API quota. A live paid call still requires configured server
credentials and an explicit user-initiated transcription.

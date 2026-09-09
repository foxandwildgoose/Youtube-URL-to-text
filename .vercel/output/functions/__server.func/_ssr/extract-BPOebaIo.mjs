import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
import { l as runWaterfall, s as isVideoId } from "./providers-MDEgyDxZ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/extract-BPOebaIo.js
var extractTranscript_createServerFn_handler = createServerRpc({
	id: "e5ac9cd43c95a6903fc6c1c22e2e9a2bff5764bd2c32177927fd65e1b35beb6a",
	name: "extractTranscript",
	filename: "src/lib/intertext/extract.ts"
}, (opts) => extractTranscript.__executeServer(opts));
var extractTranscript = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || !isVideoId(input.videoId)) throw new Error("Invalid video ID.");
	if (input.lang !== "auto" && input.lang !== "ko" && input.lang !== "en") throw new Error("Invalid language.");
	return {
		videoId: input.videoId,
		lang: input.lang
	};
}).handler(extractTranscript_createServerFn_handler, async ({ data }) => {
	return runWaterfall(data.videoId, data.lang);
});
//#endregion
export { extractTranscript_createServerFn_handler };

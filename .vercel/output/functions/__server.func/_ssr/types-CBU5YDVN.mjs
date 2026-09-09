//#region node_modules/.nitro/vite/services/ssr/assets/types-CBU5YDVN.js
var SUMMARY_KINDS = [
	{
		id: "general",
		label: "General",
		hint: "Overview of the whole talk"
	},
	{
		id: "meeting",
		label: "Meeting",
		hint: "Topics, decisions, action items"
	},
	{
		id: "course",
		label: "Course",
		hint: "Outline and key takeaways"
	},
	{
		id: "interview",
		label: "Interview",
		hint: "Host and guest, using their names"
	},
	{
		id: "podcast",
		label: "Podcast",
		hint: "Episode notes and highlights"
	}
];
function isSummaryKind(value) {
	return SUMMARY_KINDS.some((k) => k.id === value);
}
//#endregion
export { isSummaryKind as n, SUMMARY_KINDS as t };

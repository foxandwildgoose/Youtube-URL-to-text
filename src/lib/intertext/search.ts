export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countMatches(text: string, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const re = new RegExp(escapeRegExp(q), "gi");
  return text.match(re)?.length ?? 0;
}

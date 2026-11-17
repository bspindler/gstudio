// ?level=N in the page address: the 1-based level to start at (as the HUD counts), clamped to the real level count.
// Returns the 0-based index, or null when there is no usable ?level.
export function startIndexFromSearch(search, count) {
  const raw = new URLSearchParams(search).get('level');
  if (raw === null || !/^\s*\d+\s*$/.test(raw) || !(count > 0)) return null;
  return Math.min(count, Math.max(1, Number(raw))) - 1;
}

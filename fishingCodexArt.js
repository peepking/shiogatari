/**
 * 分類共通のシルエットを返す。未発見は分類を推測できない共通の記号を使う。
 * @param {string|null} category 公開済みの分類。 @returns {string} 装飾用SVG。
 */
export function codexSilhouette(category) {
  const shapes = {
    common: '<path d="M23 32C39 13 66 16 77 32C66 48 39 51 23 32L9 20V44Z"/><path d="M43 20L51 10L59 20M44 44L52 52L59 44"/>',
    big: '<path d="M21 32C35 9 67 9 81 32C67 55 35 55 21 32L7 18V46Z"/><path d="M40 18L52 7L65 18M43 46L55 56L64 45"/>',
    giant: '<path d="M20 32L7 13L11 32L7 51L25 38Q59 50 88 29Q70 22 56 24L47 7L40 25Z"/><path d="M49 39L37 54L63 42Z"/>',
  };
  const shape = shapes[category];
  return `<svg class="codex-silhouette" viewBox="0 0 96 64" aria-hidden="true" focusable="false">${shape
    ? `<g fill="currentColor">${shape}</g><circle cx="69" cy="29" r="2" class="codex-fish-eye"/>`
    : '<circle cx="48" cy="32" r="24" fill="none" stroke="currentColor" stroke-dasharray="3 5"/><path d="M41 24C41 14 59 14 57 26C56 30 48 30 48 37M48 43V46" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'}</svg>`;
}

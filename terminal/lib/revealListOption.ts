/** Reveal one result inside its own scroller, without moving focus or ancestors. */
export function revealListOption(list: HTMLElement | null, target: HTMLElement | null, scrollOwner: HTMLElement | null = list): boolean {
  if (!list || !target || !list.contains(target) || !scrollOwner?.contains(list) || !scrollOwner.clientHeight) return false;
  const style = scrollOwner.ownerDocument.defaultView?.getComputedStyle(scrollOwner);
  const start = scrollOwner.getBoundingClientRect().top + scrollOwner.clientTop;
  const top = start + (Number.parseFloat(style?.scrollPaddingTop ?? "") || 0);
  const bottom = start + scrollOwner.clientHeight - (Number.parseFloat(style?.scrollPaddingBottom ?? "") || 0);
  const bounds = target.getBoundingClientRect();
  if (bounds.height > bottom - top || bounds.top < top) scrollOwner.scrollTop += bounds.top - top;
  else if (bounds.bottom > bottom) scrollOwner.scrollTop += bounds.bottom - bottom;
  return true;
}

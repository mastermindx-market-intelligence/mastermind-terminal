/** Reveal one result inside its own scroller, without moving focus or ancestors. */
export function revealListOption(list: HTMLElement | null, optionId: string): boolean {
  const option = list?.ownerDocument.getElementById(optionId);
  if (!list || !option || !list.contains(option) || !list.clientHeight) return false;
  const top = list.getBoundingClientRect().top + list.clientTop;
  const bottom = top + list.clientHeight;
  const bounds = option.getBoundingClientRect();
  if (bounds.height > list.clientHeight || bounds.top < top) list.scrollTop += bounds.top - top;
  else if (bounds.bottom > bottom) list.scrollTop += bounds.bottom - bottom;
  return true;
}

export function useAccountPrefs() {
  return { metaPrefs: { theme: document.documentElement.dataset.fixtureTheme === "light" ? "light" : "dark" } };
}

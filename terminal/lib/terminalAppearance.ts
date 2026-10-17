/** Canonical Terminal display adapter. Account delivery remains in useMarketPrefs.
 * The device cache is the incumbent Macro theme/themeAuto cache, not account state.
 * Auto follows local 07:00–19:00; it does not mean OS color preference.
 * Server-safe: browser access happens only inside the application/read functions.
 */
export type ThemeChoice = "light" | "dark" | "auto";
export type Appearance = "light" | "dark";

export function appearanceChoice(meta: unknown, fallback: ThemeChoice = "dark"): ThemeChoice {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return fallback;
  const value = meta as { theme?: unknown; themeAuto?: unknown };
  if (value.themeAuto === "1") return "auto";
  if (value.theme === "light" || value.theme === "dark") return value.theme;
  return fallback;
}

export function resolveAppearance(choice: ThemeChoice, now = new Date()): Appearance {
  if (choice !== "auto") return choice;
  const hour = now.getHours();
  return hour >= 7 && hour < 19 ? "light" : "dark";
}

export function readAppearanceChoice(): ThemeChoice {
  try {
    return appearanceChoice({ theme: localStorage.getItem("theme"), themeAuto: localStorage.getItem("themeAuto") });
  } catch { return "dark"; }
}

/** Local device-intent observers are display consumers, not account subscribers. */
const appearanceIntentListeners = new Set<(choice: ThemeChoice) => void>();
export function subscribeAppearanceIntent(listener: (choice: ThemeChoice) => void): () => void {
  appearanceIntentListeners.add(listener);
  return () => { appearanceIntentListeners.delete(listener); };
}

/** One local application/event path for account hydration, controls and auto resume.
 * Clock/account synchronizers suppress intent notification to avoid re-arming themselves.
 */
export function applyTerminalAppearance(choice: ThemeChoice, now = new Date(), notifyIntent = true): Appearance {
  const mode = resolveAppearance(choice, now);
  if (typeof document === "undefined") return mode;
  const before = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem("theme", mode);
    if (choice === "auto") localStorage.setItem("themeAuto", "1");
    else localStorage.removeItem("themeAuto");
  } catch { /* Display still applies when the device cache is unavailable. */ }
  if (before !== mode) window.dispatchEvent(new CustomEvent("mm:theme", { detail: mode }));
  if (notifyIntent) for (const listener of [...appearanceIntentListeners]) listener(choice);
  return mode;
}

/** Calendar construction retains local timezone/DST semantics at each boundary. */
export function nextAppearanceBoundary(now = new Date()): Date {
  const hour = now.getHours();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (hour >= 19 ? 1 : 0), hour < 7 || hour >= 19 ? 7 : 19);
}

/** Runs before first paint. Kept beside the tested resolver/cache contract.
 * Cache reads are separately guarded so denied storage still sets safe dark.
 */
export const TERMINAL_APPEARANCE_INIT = `(function(){
  var mode='dark';
  try{
    var theme=localStorage.getItem('theme'), auto=localStorage.getItem('themeAuto');
    if(auto==='1'){var hour=new Date().getHours();mode=hour>=7&&hour<19?'light':'dark';}
    else if(theme==='light') mode='light';
  }catch(e){}
  document.documentElement.setAttribute('data-theme',mode);
})();`;

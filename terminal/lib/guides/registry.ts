// Guide registry — lazy dynamic imports so guide text code-splits out of the main chart bundle.
// Add a module here when its guide lands; GuidePanel falls back to an honest empty state otherwise.

type GuideDoc = { en?: string; zh?: string };

const LOADERS: Record<string, () => Promise<GuideDoc>> = {
  "macdx/div": () => import("./macdx/div"),
  "macdx/eng": () => import("./macdx/eng"),
  "macdx/hist": () => import("./macdx/hist"),
  "macdx/mtf": () => import("./macdx/mtf"),
  "macdx/sig": () => import("./macdx/sig"),
  "macdx/trend": () => import("./macdx/trend"),
  "pulse/div": () => import("./pulse/div"),
  "pulse/flow": () => import("./pulse/flow"),
  "pulse/mtf": () => import("./pulse/mtf"),
  "pulse/sig": () => import("./pulse/sig"),
  "pulse/vmap": () => import("./pulse/vmap"),
  "pulse/wave": () => import("./pulse/wave"),
  "rsix/chan": () => import("./rsix/chan"),
  "rsix/div": () => import("./rsix/div"),
  "rsix/eng": () => import("./rsix/eng"),
  "rsix/mtf": () => import("./rsix/mtf"),
  "rsix/sig": () => import("./rsix/sig"),
  "structure/fvg": () => import("./structure/fvg"),
  "structure/liq": () => import("./structure/liq"),
  "structure/mfp": () => import("./structure/mfp"),
  "structure/pat": () => import("./structure/pat"),
  "structure/sr": () => import("./structure/sr"),
  "structure/ms": () => import("./structure/ms"),
  "structure/ob": () => import("./structure/ob"),
  "structure/pd": () => import("./structure/pd"),
  "structure/sfp": () => import("./structure/sfp"),
  "trend/cp": () => import("./trend/cp"),
  "trend/dash": () => import("./trend/dash"),
  "trend/fb": () => import("./trend/fb"),
  "trend/nine": () => import("./trend/nine"),
  "trend/te": () => import("./trend/te"),
  "trend/vb": () => import("./trend/vb"),
};

export function hasGuide(suiteKey: string, moduleKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOADERS, `${suiteKey}/${moduleKey}`);
}

/** Returns the guide text for the requested language, or the EN fallback, or null. */
export async function loadGuide(suiteKey: string, moduleKey: string, lang: "en" | "zh"): Promise<{ text: string; fellBack: boolean } | null> {
  const loader = LOADERS[`${suiteKey}/${moduleKey}`];
  if (!loader) return null;
  let doc: GuideDoc;
  try { doc = await loader(); } catch { return null; }
  const want = doc[lang];
  if (typeof want === "string" && want.trim()) return { text: want, fellBack: false };
  const en = doc.en;
  if (typeof en === "string" && en.trim()) return { text: en, fellBack: lang !== "en" };
  return null;
}

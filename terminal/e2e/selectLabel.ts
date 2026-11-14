import { expect, type Locator } from "@playwright/test";

/** Measure the complete selected label in the browser's actual loaded font. */
export async function expectSelectLabelFits(select: Locator) {
  const fit = await select.evaluate(async (element) => {
    await document.fonts.ready;
    const field = element as HTMLSelectElement;
    const style = getComputedStyle(field);
    const text = field.selectedOptions[0]?.textContent ?? "";
    const specimen = document.createElement("span");
    Object.assign(specimen.style, {
      position: "fixed", visibility: "hidden", whiteSpace: "pre",
      font: style.font, letterSpacing: style.letterSpacing,
      fontVariantNumeric: style.fontVariantNumeric,
      fontFeatureSettings: style.fontFeatureSettings,
    });
    specimen.textContent = text;
    document.body.append(specimen);
    const textWidth = specimen.getBoundingClientRect().width;
    specimen.remove();
    return {
      text, textWidth,
      available: field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  });
  expect(fit.text).not.toBe("");
  expect(fit.available, `Complete event label must fit: ${fit.text}`).toBeGreaterThanOrEqual(fit.textWidth);
}

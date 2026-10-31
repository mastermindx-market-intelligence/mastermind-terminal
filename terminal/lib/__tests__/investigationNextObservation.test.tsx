import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InvestigationNextObservation from "@/components/workspaces/InvestigationNextObservation";

describe("saved next observation", () => {
  it.each([undefined, ""])("does not invent a value for %s", value => {
    expect(renderToStaticMarkup(<InvestigationNextObservation value={value} lang="en"/>)).toBe("");
  });
  it.each([['en', 'Next observation'], ['zh', '下一项观察']] as const)("labels the saved value in %s", (lang, label) => {
    const html = renderToStaticMarkup(<InvestigationNextObservation value="Retained observation" lang={lang}/>);
    expect(html).toContain(label);
    expect(html).toContain("Retained observation");
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h3 id="${id}">`);
  });
  it("preserves whitespace and escapes retained markup without interpreting it", () => {
    const value = '  Observe <script>unsafe()</script> & "quoted"\nSecond line  ';
    const html = renderToStaticMarkup(<InvestigationNextObservation value={value} lang="en"/>);
    expect(html).toContain('  Observe &lt;script&gt;unsafe()&lt;/script&gt; &amp; &quot;quoted&quot;\nSecond line  ');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<(button|input|textarea|select|a)\b/);
  });
  it("renders only the supplied revision across independent renders", () => {
    const first = renderToStaticMarkup(<InvestigationNextObservation value="First revision" lang="en"/>);
    const second = renderToStaticMarkup(<InvestigationNextObservation value="Second revision" lang="en"/>);
    expect(first).toContain("First revision");
    expect(first).not.toContain("Second revision");
    expect(second).toContain("Second revision");
    expect(second).not.toContain("First revision");
  });
});

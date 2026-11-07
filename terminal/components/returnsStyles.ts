import styles from "./ReturnsStudy.module.css";

/** Preserve existing DOM/test hooks while applying the Returns-owned module styles. */
export function returnsClassNames(names: string): string {
  return names.split(/\s+/).filter(Boolean).flatMap(name => [name, styles[name]]).filter(Boolean).join(" ");
}

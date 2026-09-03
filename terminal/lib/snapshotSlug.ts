// One definition of what a snapshot slug is, shared by everything that handles one.
//
// The share page validated the slug inline before rendering, but `generateMetadata` — which runs
// FIRST, and whose output is what Discord/Slack/Twitter actually fetch — took the raw path segment
// and interpolated it straight into the OG and Twitter image URLs. So an unvalidated, attacker-
// chosen string was reflected into markup and handed to third-party unfurlers before the page ever
// reached its own check.
//
// Two copies of a rule are two chances to apply only one of them. There is now one.

/** The generator's alphabet and length: 10 chars of lowercase base36. */
const SNAPSHOT_SLUG = /^[0-9a-z]{10}$/;

export function isSnapshotSlug(slug: string): boolean {
  return SNAPSHOT_SLUG.test(slug);
}

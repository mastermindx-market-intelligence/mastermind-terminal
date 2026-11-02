import { createHash } from "node:crypto";
import ts from "typescript";

const OMITTED_PROPERTY = "obDonePrefsSyncing";
const SCHEMA = "terminal.lex_capture_projection.v1";
const sha256 = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");

/** Keep every source byte except the one direct, uniquely named LEX property.
 * This is a capture dependency projection, not a translation/formatting normalizer.
 */
export function projectCapturedLex(source: string): string {
  const file = ts.createSourceFile("captured-i18n.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) {
    throw new Error("Invalid captured LEX syntax");
  }
  const declarations = file.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
    return statement.declarationList.declarations.filter((d) => ts.isIdentifier(d.name) && d.name.text === "LEX");
  });
  if (declarations.length !== 1) throw new Error("Expected one exported LEX declaration");
  let initializer = declarations[0].initializer;
  while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
    initializer = initializer.expression;
  }
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) throw new Error("Expected a literal LEX object");
  const properties: ts.PropertyAssignment[] = [];
  for (const property of initializer.properties) {
    // An evaluated/computed member could define the omitted key a second time.
    if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))) {
      throw new Error("Computed or spread LEX properties are not a captured literal contract");
    }
    const name = property.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === OMITTED_PROPERTY) {
      if (!ts.isPropertyAssignment(property)) throw new Error("Expected a direct LEX property assignment");
      properties.push(property);
    }
  }
  if (properties.length !== 1) throw new Error("Expected one pending-preferences LEX property");
  const property = properties[0];
  const tuple = property.initializer;
  if (!ts.isArrayLiteralExpression(tuple) || tuple.elements.length !== 2 || !tuple.elements.every(ts.isStringLiteral)) {
    throw new Error("Expected exactly two literal translations");
  }
  return source.slice(0, property.getStart(file)) + "/* captured pending-preferences copy omitted */" + source.slice(property.end);
}

/** Called on the actual retained historical bytes, before minting a projection. */
export function fingerprintCapturedLex(source: string, expectedRawSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(expectedRawSha256) || sha256(source) !== expectedRawSha256) {
    throw new Error("Captured LEX bytes do not match the preserved raw source hash");
  }
  return sha256(projectCapturedLex(source));
}

/** Verify current LEX against a projection derived from the recorded source.
 * The original layoutFiles raw hash, capture identity and crop locks stay intact.
 * Only the pending-onboarding copy, verified absent from these captures, may differ.
 */
export function assertCapturedLexProjection(currentSource: string, recordedRawSha256: string, manifest: string): void {
  const rows = manifest.split("\n").filter((line) => line.startsWith("lexProjection: "));
  if (rows.length !== 1) throw new Error("Expected one captured LEX projection binding");
  const binding = JSON.parse(rows[0].slice("lexProjection: ".length));
  if (binding.schema !== SCHEMA || binding.omittedProperty !== OMITTED_PROPERTY ||
      binding.capturedRawSha256 !== recordedRawSha256 || !/^[0-9a-f]{64}$/.test(binding.projectedSha256) ||
      !/^[0-9a-f]{40}$/.test(binding.sourceGitBlob) || !/^[0-9a-f]{40}$/.test(binding.sourceRecoveryCommit) ||
      typeof binding.captureCommitLocallyAvailable !== "boolean") {
    throw new Error("Invalid captured LEX projection provenance");
  }
  if (sha256(projectCapturedLex(currentSource)) !== binding.projectedSha256) {
    throw new Error("Captured LEX changed outside the pending-preferences copy");
  }
}

/** Fresh captures retain the original full-byte lock. Projection applies only
 * to retained historical source whose one unused onboarding tuple changed. */
export function assertCapturedLexEvidence(currentSource: string, recordedRawSha256: string, manifest: string): void {
  if (!/^[0-9a-f]{64}$/.test(recordedRawSha256)) throw new Error("Invalid captured LEX raw hash");
  if (sha256(currentSource) === recordedRawSha256) return;
  assertCapturedLexProjection(currentSource, recordedRawSha256, manifest);
}

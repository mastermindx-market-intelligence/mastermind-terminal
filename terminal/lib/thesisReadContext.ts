// ID-only source owned by the mounted thesis workspace. No storage, I/O or authority.
export type ThesisReadSelection = { thesis_id: string; version_id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let source: { token: symbol; read: () => ThesisReadSelection | null } | null = null;
export function installThesisReadSource(read: () => ThesisReadSelection | null): () => void {
  const token = Symbol("thesis-read-owner");
  source = { token, read };
  return () => { if (source?.token === token) source = null; };
}
export function currentThesisReadSelection(): ThesisReadSelection | null {
  const value = source?.read();
  if (!value || !UUID.test(value.thesis_id) || !UUID.test(value.version_id)) return null;
  // A turn takes an immutable copy; later UI selection cannot mutate it.
  return Object.freeze({ thesis_id: value.thesis_id, version_id: value.version_id });
}

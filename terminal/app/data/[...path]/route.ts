// Next serves existing public files before dynamic routes. Only a missing /data
// resource reaches this fallback; it must never inherit the HTML shell's auth
// state or become a streamed 200 account-unavailable document.
export const dynamic = "force-dynamic";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export function GET() {
  return Response.json({ error: "not_found" }, { status: 404, headers });
}

export function HEAD() {
  return new Response(null, { status: 404, headers });
}

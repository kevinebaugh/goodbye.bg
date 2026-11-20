// POST /api/diag
// Step-by-step diagnostics from a browser that has ?debug=1 in the address (used to chase crashes on
// phones). Only step names and numbers, never photo data. Written to the Functions log, not stored.
export async function onRequestPost({ request }) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return new Response(null, { status: 403 });
  const text = (await request.text()).slice(0, 2000);
  console.log("diag", text);
  return new Response(null, { status: 204 });
}

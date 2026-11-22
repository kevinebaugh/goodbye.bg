// Small pieces the Pages Functions share.

// A request from another site. Browsers send Sec-Fetch-Site; a request without it (old browsers, curl) passes.
export const crossSite = (request) => {
  const site = request.headers.get("Sec-Fetch-Site");
  return !!site && site !== "same-origin";
};

// The device kind from the User-Agent: never more than these four words.
export const device = (request) => {
  const ua = request.headers.get("User-Agent") || "";
  return /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Macintosh|Windows|Linux|CrOS/.test(ua) ? "desktop" : "other";
};

// The engine names votes and crash reports may carry (CLAUDE.md, Engines); anything else is ISNet on the CPU.
export const engineOf = (e) => (["gpu", "gpu-birefnet", "cpu-birefnet640"].includes(e) ? e : "cpu");

// A plain-text error that no cache keeps.
export const fail = (status, message) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

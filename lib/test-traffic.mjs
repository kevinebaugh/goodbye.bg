// Test visits must not land in the A/B, vote or crash data. The page marks what a test visit sends (a test switch such
// as ?adtest in its address, or navigator.webdriver) with t=1 in the query or "t": 1 in the body; headless Chrome is
// caught by its User-Agent as well. The functions still answer as usual (204, or the redirect), they just don't write.
export function isTest(request, body) {
  if (new URL(request.url).searchParams.get("t") === "1" || body?.t === 1) return true;
  return /HeadlessChrome/.test(request.headers.get("User-Agent") || "");
}

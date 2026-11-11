// This evidence packet isolates the optional same-origin Brain account read.
// It proves options-axis rendering; a guest fixture does not establish account
// authentication or entitlement. Keep unrelated origins, endpoints and writes live.
export const BRAIN_ME_PATH = "/api/brain/me";

export function isBrainMeUrl(url, baseURL) {
  try {
    const target = new URL(url);
    const base = new URL(baseURL);
    return ["http:", "https:"].includes(base.protocol)
      && target.origin === base.origin
      && target.pathname === BRAIN_ME_PATH;
  } catch {
    return false;
  }
}

// Existing guest usage shape from the account companion's house fixtures.
export const BRAIN_GUEST_USAGE = {
  tier: "guest",
  quotas: {
    fast: { remaining: 0, limit: 0, period: "day" },
    pro: { remaining: 0, limit: 0, period: "day" },
  },
};

export async function installBrainAccountIsolation(page, baseURL) {
  await page.route((url) => isBrainMeUrl(url, baseURL), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: BRAIN_GUEST_USAGE });
  });
}

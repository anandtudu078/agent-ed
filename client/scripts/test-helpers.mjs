// Permanent helpers shared by the browser suites.
//
// The consent step is the reason this file exists. Registration no longer leads
// straight into the app — the server refuses AI calls until consent is recorded —
// so every suite that signs up has to agree to the notice, the same way a student
// does. Written once here so the suites cannot drift from the real flow, and so a
// change to the consent form breaks in one place instead of five.

/**
 * Complete the consent step every new account lands on.
 *
 * Defaults to the 18+ band, which needs no guardian. The guardian branch has its
 * own checks in the UI suite; the rules themselves are covered by
 * `npm run test:offline`.
 */
export async function acceptConsent(page, { band = "18-plus" } = {}) {
  await page.locator("#consent-view").waitFor({ state: "visible", timeout: 20000 });
  await page.locator(`#consent-view input[name="consent-age"][value="${band}"]`).check();
  if (band !== "18-plus") {
    await page.locator("#consent-guardian").waitFor({ state: "visible" });
    await page.locator("#consent-guardian-name").fill("Test Guardian");
    await page.locator("#consent-guardian-check").check();
  }
  await page.locator("#consent-terms").check();
  await page.locator("#consent-submit").click();
  await page.locator("#app-view").waitFor({ state: "visible", timeout: 20000 });
}


// Capture README screenshots by driving the real app.
// Run: node client/scripts/capture-screenshots.mjs
//
// Not a test: it asserts nothing and exits 0 even if a step is skipped, so it
// can never be mistaken for coverage. Its only job is to produce the images the
// README links to, and to do it by actually clicking through the product rather
// than by mocking any of it.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.SHOT_URL ?? "http://localhost:5173";
// The tutor lives at /app.html; the bare origin is the landing page. Getting
// this backwards is what stalled the first run of this script — the landing
// page has no #auth-toggle, so every field fill timed out.
const APP = `${FRONTEND}/app.html`;
const OUT = process.env.SHOT_DIR ?? "docs/screenshots";
const USER = `shots${Date.now().toString(36).slice(-6)}`;
const PASS = "screenshots-pass-123";
const NAME = "Priya Sharma";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`wrote ${OUT}/${name}.png`);
};

try {
  // 1. Landing page.
  await page.goto(FRONTEND, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot("01-landing");

  // 2. Sign-up. The tutor is at /app.html, and the app only mounts its own
  // JS once window.__agentedTest is defined, so wait for that rather than for
  // networkidle -- the socket connection keeps the network busy indefinitely.
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__agentedTest !== undefined, { timeout: 20000 });
  await page.locator("#auth-view").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#auth-toggle").click();
  await page.locator("#display-name-input").fill(NAME);
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.waitForTimeout(300);
  await shot("02-signup");
  await page.locator("#auth-submit").click();

  // 3. Consent — the gate that has to be answered before any AI call. Both the
  // age band AND the terms checkbox are required; the submit button refuses
  // without them, so skipping the second box just re-shows the form.
  await page.locator("#consent-view").waitFor({ state: "visible", timeout: 20000 });
  await page.locator('#consent-view input[name="consent-age"][value="18-plus"]').check();
  await page.locator("#consent-terms").check();
  await page.waitForTimeout(300);
  await shot("03-consent");
  await page.locator("#consent-submit").click();
  await page.locator("#app-view").waitFor({ state: "visible", timeout: 20000 });

  // 4. The owl with a real lesson on the board. In demo mode the stand-in reply
  // is deterministic, so waiting for the bubble to fill is reliable rather than
  // a guess at a timeout.
  await page.locator("#message-input").fill("Teach me backpropagation");
  await page.locator("#send-button").click();
  await page
    .waitForFunction(
      () => (document.querySelector("#owl-stage .owl-message")?.textContent?.length ?? 0) > 120,
      null,
      { timeout: 25000 },
    )
    .catch(() => console.warn("owl bubble did not fill; capturing anyway"));
  await page.waitForTimeout(3500);
  await shot("04-tutor-lesson");

  // 5. A follow-up turn, so the screenshot shows a conversation rather than one
  // exchange -- the memory loop is the thing being demonstrated.
  await page.locator("#message-input").fill("I still don't get why the gradients vanish");
  await page.locator("#send-button").click();
  await page.waitForTimeout(6000);
  await shot("05-follow-up-turn");

  // 6. Hindi, because it is a real mode and not a checkbox.
  await page.locator("#language-toggle").click().catch(() => {});
  await page.waitForTimeout(2500);
  await shot("06-hindi");
  await page.locator("#language-toggle").click().catch(() => {});
  await page.waitForTimeout(800);

  // 7. The dashboard: alerts, due reviews, course progress.
  await page.locator("#dashboard-toggle").click();
  await page.locator("#dashboard-view").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(3000);
  await shot("07-dashboard");

  // 8. The course catalog, reachable from the dashboard.
  const catalog = page.locator(".dash-courses-open, button:has-text('Browse courses'), button:has-text('Courses')").first();
  if (await catalog.count()) {
    await catalog.click().catch(() => {});
    await page.waitForTimeout(3000);
    await shot("08-course-catalog");
  }
} catch (error) {
  // Deliberately non-fatal. A missing screenshot is a gap in the README, not a
  // broken build, and this script must never be wired into CI as a gate.
  console.error("screenshot capture stopped early:", error.message);
  await shot("99-partial-state").catch(() => {});
} finally {
  await browser.close();
  console.log("done");
}
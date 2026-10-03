// Login page check. Run: node scripts/login-check.mjs
// Covers: page render, client-side validation, wrong password, successful
// sign-in, register-mode toggle, and that errors surface to the user.
import { chromium } from "playwright";

// The tutor lives at /app.html; the bare origin is the landing page. Pointing
// this at the origin meant every one of its render checks failed against a page
// that has no sign-in form on it -- which is why it was never run. The bare
// origin is itself worth asserting against, so both URLs are covered: this file
// checks the sign-in form, workflow-test.mjs checks the landing page.
const CLIENT = process.env.LOGIN_CHECK_URL ?? "http://localhost:5173/app.html";
const results = [];
const check = (label, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

// Poll instead of fixed waits: production latency (Render cold starts,
// cross-region hops) routinely exceeds a second, so fixed sleeps misreport
// working features as failures.
async function waitUntil(poll, timeoutMs = 10000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await poll()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(CLIENT, { waitUntil: "networkidle" });

  // 1. Login page renders the essentials.
  check("auth view visible", await page.locator("#auth-view").isVisible());
  check("username field present", await page.locator("#username-input").isVisible());
  check("password field present", await page.locator("#password-input").isVisible());
  check("submit button present", await page.locator("#auth-submit").isVisible());
  const title = await page.locator("#auth-title").textContent();
  check("welcome heading shown", title?.includes("Welcome back"), title ?? "");

  // 2. Empty submit must show a client-side error, not hang.
  await page.locator("#auth-submit").click();
  await page.waitForTimeout(400);
  const emptyErr = await page.locator("#auth-error").textContent();
  check("empty form rejected with message", Boolean(emptyErr?.trim()), emptyErr ?? "(none)");

  // 3. Register mode toggle works.
  await page.locator("#auth-toggle").click();
  const regTitle = await page.locator("#auth-title").textContent();
  check("register toggle switches mode", regTitle?.includes("Create your account"), regTitle ?? "");
  await page.locator("#auth-toggle").click(); // back to sign-in

  // 4. Wrong password shows the server error inline.
  const user = `loginchk${Math.floor(Math.random() * 1e6)}`;
  await page.locator("#username-input").fill(user);
  await page.locator("#password-input").fill("wrong-password-1");
  await page.locator("#auth-submit").click();
  const errAppeared = await waitUntil(async () =>
    (await page.locator("#auth-error").textContent())?.includes("Invalid username or password"),
  );
  const wrongErr = await page.locator("#auth-error").textContent();
  check("wrong password shows inline error", errAppeared, wrongErr ?? "(none)");

  // 5. Register a fresh account through the UI, then it should sign us in.
  // Registration now lands on a consent step (privacy gate) before the app.
  await page.locator("#auth-toggle").click(); // to register mode
  await page.locator("#display-name-input").fill("Login Checker");
  await page.locator("#username-input").fill(user);
  await page.locator("#password-input").fill("login-pass-12345");
  await page.locator("#auth-submit").click();
  try {
    // Wait for either the app (consent already granted) or the consent step.
    await Promise.race([
      page.locator("#app-view").waitFor({ state: "visible", timeout: 8000 }),
      page.locator("#consent-view").waitFor({ state: "visible", timeout: 8000 }).then(() => "consent"),
    ]);
    if (await page.locator("#consent-view").isVisible()) {
      check("register lands on consent step", true);
      // Complete the consent form: 18+, accept terms.
      await page.locator('input[name="consent-age"][value="18-plus"]').check();
      await page.locator("#consent-terms").check();
      await page.locator("#consent-submit").click();
      await page.locator("#app-view").waitFor({ state: "visible", timeout: 8000 });
    }
    check("register signs the student in (app view appears)", true);
    check("user badge shows display name", (await page.locator("#user-badge").textContent())?.includes("Login Checker") ?? false);

    // 6. Reload keeps the session (persisted auth).
    await page.reload({ waitUntil: "networkidle" });
    check("session survives reload", await page.locator("#app-view").isVisible());

    // 7. Sign out returns to the login page cleanly.
    await page.locator("#sign-out-button").click();
    const backToAuth = await waitUntil(() => page.locator("#auth-view").isVisible());
    check("sign out returns to login", backToAuth);

    // 8. Sign in with the credentials just created.
    await page.locator("#username-input").fill(user);
    await page.locator("#password-input").fill("login-pass-12345");
    await page.locator("#auth-submit").click();
    await page.locator("#app-view").waitFor({ state: "visible", timeout: 8000 });
    check("sign in with fresh credentials works", true);
  } catch (e) {
    check("register/sign-in flow completed", false, String(e).slice(0, 120));
  }

  // Console errors are expected for intentional 401s; only flag crashes.
  const crashes = consoleErrors.filter(
    (m) => !m.includes("401") && !m.includes("Failed to load resource"),
  );
  check("no unexpected console errors", crashes.length === 0, crashes[0] ?? "");
} catch (error) {
  check("unexpected failure", false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} login checks passed`);
process.exit(failed ? 1 : 0);

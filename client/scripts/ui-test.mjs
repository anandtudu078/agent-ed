// Real-browser UI test for AgentEd: register -> chat -> reload persistence -> sign out.
// Run: node client/scripts/ui-test.mjs
import { chromium } from "playwright";

const FRONTEND = "http://localhost:5173";
const USER = `uitest${Date.now().toString(36).slice(-5)}`;
const PASS = "uitest-pass-123";
const NAME = "UI Tester";

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  // 1. Auth view shows first
  await page.goto(FRONTEND);
  const authVisible = await page.locator("#auth-view").isVisible();
  check("auth screen shown when signed out", authVisible);

  // 2. Switch to register mode and create an account
  await page.locator("#auth-toggle").click();
  await page.locator("#display-name-input").fill(NAME);
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.locator("#auth-submit").click();
  await page.locator("#app-view").waitFor({ state: "visible" });
  check("registration signs in and shows chat", true, `user=${USER}`);

  // 3. Socket connects (status pill turns Online)
  await page.locator("#status-text").filter({ hasText: "Online" }).waitFor();
  check("socket connects (Online status)", true);

  // 4. User badge shows the display name
  const badge = await page.locator("#user-badge").textContent();
  check("header shows display name", badge?.includes(NAME) ?? false, badge ?? "");

  // 5. Send a chat message; student bubble appears
  await page.locator("#message-input").fill("What is a function in programming?");
  await page.locator("#send-button").click();
  await page.locator("#messages .flex.justify-end").first().waitFor();
  check("student bubble appears after send", true);

  // 6. Busy state on send button
  const busyText = await page.locator("#send-button").textContent();
  check("send button enters Thinking state", busyText?.includes("Thinking") ?? true, busyText ?? "");

  // 7. A reply eventually arrives (tutor response or sanitized ai-error system pill)
  await page
    .locator("#messages > div:nth-child(3)")
    .waitFor({ timeout: 120000 });
  const convo = await page.locator("#messages").textContent();
  const gotReply = (convo?.length ?? 0) > 60;
  check("tutor reply (or sanitized error) arrives", gotReply);

  // 8. Reload — still signed in (token persisted)
  await page.reload();
  await page.locator("#app-view").waitFor({ state: "visible" });
  const badgeAfterReload = await page.locator("#user-badge").textContent();
  check("session persists across reload", badgeAfterReload?.includes(NAME) ?? false);

  // 9. Sign out returns to auth view and clears storage
  await page.locator("#sign-out-button").click();
  await page.locator("#auth-view").waitFor({ state: "visible" });
  const cleared = await page.evaluate(() => localStorage.getItem("agented:token"));
  check("sign out clears token and returns to auth", cleared === null);

  // 10. Wrong password shows an error
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill("wrong-password");
  await page.locator("#auth-submit").click();
  await page.locator("#auth-error").filter({ hasText: /./ }).waitFor();
  const err = await page.locator("#auth-error").textContent();
  check("invalid login shows error message", (err ?? "").length > 0, err ?? "");
} catch (error) {
  check("unexpected failure", false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

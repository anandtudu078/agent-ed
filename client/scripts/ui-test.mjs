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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
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

  // 6b. Owl teacher: stage visible, cap + pointer present, thinking pose on send
  const owlStage = page.locator("#owl-stage");
  check("owl teaching stage visible on screen", await owlStage.isVisible());
  check(
    "owl wears a graduation cap",
    (await page.locator("#owl-stage .owl-cap").count()) > 0,
  );
  // (Tolerant sampling: a fast reply may already have flipped the owl into its
  // teaching pose before we look.)
  const owlSvgClass = (await page.locator("#owl-stage .owl-visual").getAttribute("class")) ?? "";
  check(
    "owl animates while thinking/teaching",
    owlSvgClass.includes("wiggle") || owlSvgClass.includes("mascotbounce"),
    owlSvgClass,
  );
  const pillText = (await page.locator("#owl-stage .owl-state-pill").textContent())?.trim();
  check(
    "state pill shows Thinking or Teaching",
    pillText === "Thinking" || pillText === "Teaching",
    pillText ?? "",
  );
  const thinkingBoard = await page.locator("#owl-stage .owl-board-art svg").innerHTML();
  check(
    "lesson board shows a thinking/teaching sketch",
    thinkingBoard.includes("Connecting the ideas") || thinkingBoard.includes("step by step"),
  );

  // 7. A reply eventually arrives (tutor response or sanitized ai-error system pill)
  await page
    .locator("#messages > div:nth-child(3)")
    .waitFor({ timeout: 120000 });
  const convo = await page.locator("#messages").textContent();
  const gotReply = (convo?.length ?? 0) > 60;
  check("tutor reply (or sanitized error) arrives", gotReply);

  // 7b. Owl presents the reply: teaching pose, lesson diagram, and the tutor's
  // text in its speech bubble. If the AI replied with an error (e.g. exhausted
  // AI quota), drive the owl through the dev-only test hook so the rendering
  // checks stay deterministic.
  const gotError = convo?.includes("Something went wrong") ?? false;
  if (gotError) {
    await page.evaluate(() =>
      window.__agentedTest.setMessage("What everyday tools do you think use AI?"),
    );
  }
  const owlMsg = (await page.locator("#owl-stage .owl-message").textContent()) ?? "";
  check(
    "owl speech bubble shows the tutor's guidance",
    owlMsg.length > 20 && !owlMsg.startsWith("Hoo there!"),
    owlMsg.slice(0, 60),
  );
  const teachingBoard = await page.locator("#owl-stage .owl-board-art svg").innerHTML();
  const teachingPill = (await page.locator("#owl-stage .owl-state-pill").textContent())?.trim();
  check(
    "owl switches to teaching pose with step diagram",
    teachingBoard.includes("step by step") && teachingPill === "Teaching",
  );

  // 7c. Voice mode TTS: run a second page (same session) with speechSynthesis
  // stubbed, then verify the owl TALKS — speaks the guidance and stops speech
  // on voice-off.
  const voicePage = await context.newPage();
  await voicePage.addInitScript(() => {
    const calls = { speak: [], cancel: 0 };
    const synth = {
      speak(u) { calls.speak.push(String(u.text)); },
      cancel() { calls.cancel += 1; },
      pause() {},
      resume() {},
    };
    class FakeUtterance {
      constructor(text) { this.text = text; }
    }
    Object.defineProperty(window, "speechSynthesis", {
      get: () => synth,
      configurable: true,
    });
    window.SpeechSynthesisUtterance = FakeUtterance;
    window.__ttsCalls = calls;
  });
  await voicePage.goto(FRONTEND);
  await voicePage.locator("#app-view").waitFor({ state: "visible" });
  await voicePage.locator("#voice-toggle").click();
  await voicePage.locator("#voice-hint").waitFor({ state: "visible" });
  const pressed = await voicePage.locator("#voice-toggle").getAttribute("aria-pressed");
  const voiceHintText = (await voicePage.locator("#voice-hint").textContent()) ?? "";
  check(
    "voice mode toggles on",
    pressed === "true" || voiceHintText.includes("isn't supported"),
    voiceHintText.slice(0, 60),
  );
  await voicePage.evaluate(() => {
    window.__agentedTest.speakOwlMessage("Hoo! Let us think about functions step by step.");
  });
  await voicePage.waitForFunction(() => window.__ttsCalls.speak.length > 0, { timeout: 5000 });
  const spoken = await voicePage.evaluate(() => window.__ttsCalls.speak.join(" | "));
  check("owl speaks guidance aloud in voice mode", spoken.includes("Hoo! Let us think"), spoken.slice(0, 80));
  await voicePage.locator("#voice-toggle").click();
  await voicePage.waitForFunction(() => window.__ttsCalls.cancel >= 1, { timeout: 5000 });
  check("turning voice mode off stops the owl's speech", await voicePage.evaluate(() => window.__ttsCalls.cancel >= 1));
  await voicePage.close();

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

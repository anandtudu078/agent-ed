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
  // Wait for the app module to finish wiring listeners (dev-only boot signal
  // set at the end of main.ts) — avoids racing Vite's cold transforms.
  await page.waitForFunction(() => window.__agentedTest !== undefined);
  await page.locator("#auth-view, #app-view").first().waitFor({ state: "visible" });
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

  // 7. A reply eventually arrives (tutor response or sanitized ai-error pill).
  // Live AI providers are sometimes down/out of quota, so wait a short window
  // first, then fall back to the dev hook that drives the identical client
  // handler — the client-side reply path is always covered.
  let replyFrom = "live";
  try {
    await page
      .locator("#messages > div:nth-child(3)")
      .waitFor({ timeout: 25000 });
  } catch {
    replyFrom = "simulated";
    await page.evaluate(() =>
      window.__agentedTest.simulateReply(
        "Good start! Before I explain: what do you think a function does to the flow of a program?",
      ),
    );
    await page.locator("#messages > div:nth-child(3)").waitFor({ timeout: 5000 });
  }
  const convo = await page.locator("#messages").textContent();
  const gotReply = (convo?.length ?? 0) > 60;
  // An ai-error pill is also the third child, so "source=live" on its own can
  // mean the provider failed. Say which actually happened.
  const hadProviderError = convo?.includes("Something went wrong") ?? false;
  check(
    "tutor reply (or sanitized error) arrives",
    gotReply,
    `source=${replyFrom}${hadProviderError ? " +provider-error" : ""}`,
  );

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
  // The owl now reveals its line word by word so it reads as speech, so the
  // bubble must be allowed to finish revealing before we assert on it.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("#owl-stage .owl-message");
        if (!el) return false;
        const full = el.getAttribute("title") || el.getAttribute("aria-label") || "";
        return full.length > 0 && (el.textContent || "").length >= full.length;
      },
      { timeout: 10000 },
    )
    .catch(() => {});
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
  check(
    "owl is animating as though speaking while it delivers a line",
    await page.locator("#owl-stage .owl-display.owl-talking").isVisible().catch(() => false),
  );
  check(
    "owl has a moving beak to lip-sync with",
    (await page.locator("#owl-stage .owl-beak").count()) === 1,
  );

  // 7b-2. Teach mode: the owl's own toggle switches the tutor from asking to
  // explaining, and the new lesson board reflects that.
  const modeBtn = page.locator("#owl-stage .owl-mode-toggle");
  check("owl offers a mode toggle", await modeBtn.isVisible());
  check(
    "starts in Socratic mode",
    ((await modeBtn.textContent()) ?? "").trim().toLowerCase().includes("socratic"),
  );
  await modeBtn.click();
  await page.waitForTimeout(300);
  check(
    "toggle switches to Teach me",
    ((await modeBtn.textContent()) ?? "").trim().toLowerCase().includes("teach"),
    ((await modeBtn.textContent()) ?? "").trim(),
  );
  const explainBoard = await page.locator("#owl-stage .owl-board-art svg").innerHTML();
  check(
    "teach mode shows the explaining board, not the quiz board",
    explainBoard.includes("Let me walk you through it") && !explainBoard.includes("step by step"),
  );
  // Toggling back returns the owl to its original posture.
  await modeBtn.click();
  await page.waitForTimeout(300);
  check(
    "toggle switches back to Socratic",
    ((await modeBtn.textContent()) ?? "").trim().toLowerCase().includes("socratic"),
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

  // 7d. Mobile layout: on a phone viewport the display starts collapsed to a
  // compact bar and expands via the chevron; on desktop there is no toggle.
  check(
    "desktop has no collapse toggle and shows the bubble",
    (await page.locator("#owl-stage .owl-toggle").isHidden()) &&
      (await page.locator("#owl-stage .owl-bubble").isVisible()),
  );
  const stored = await page.evaluate(() => ({
    token: localStorage.getItem("agented:token"),
    user: localStorage.getItem("agented:user"),
  }));
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.addInitScript(
    ([token, user]) => {
      localStorage.setItem("agented:token", token);
      localStorage.setItem("agented:user", user);
    },
    [stored.token, stored.user],
  );
  await mobilePage.goto(FRONTEND);
  await mobilePage.waitForFunction(() => window.__agentedTest !== undefined);
  await mobilePage.locator("#app-view").waitFor({ state: "visible" });
  await mobilePage.locator("#owl-stage .owl-compact").waitFor({ state: "visible" });
  check(
    "mobile starts collapsed to compact bar",
    (await mobilePage.locator("#owl-stage .owl-bubble").isHidden()) &&
      (await mobilePage.locator("#owl-stage .owl-toggle").getAttribute("aria-expanded")) === "false",
  );
  await mobilePage.locator("#owl-stage .owl-toggle").click();
  await mobilePage.locator("#owl-stage .owl-bubble").waitFor({ state: "visible" });
  check(
    "chevron expands the full classroom display",
    (await mobilePage.locator("#owl-stage .owl-toggle").getAttribute("aria-expanded")) === "true",
  );
  await mobilePage.locator("#owl-stage .owl-toggle").click();
  await mobilePage.locator("#owl-stage .owl-compact").waitFor({ state: "visible" });
  check("chevron collapses back to compact bar", await mobilePage.locator("#owl-stage .owl-bubble").isHidden());
  await mobileContext.close();

  // 7e. Learning dashboard: header toggle reveals the hub, analytics cards
  // render, quick action exists, and catalog search filters live.
  await page.locator("#dashboard-toggle").click();
  await page.locator("#dashboard-view").waitFor({ state: "visible" });
  check("header toggle shows dashboard", true);
  await page.locator(".dash-courses .dash-course").first().waitFor();
  check("course catalog renders seeded courses", (await page.locator(".dash-courses .dash-course").count()) >= 4);
  check(
    "learning speed card renders",
    ((await page.locator(".dash-speed").textContent()) ?? "").trim().length > 0,
  );
  check(
    "weak points + AI feedback cards render",
    (await page.locator(".dash-weakpoints-body").isVisible()) && (await page.locator(".dash-feedback-body").isVisible()),
  );
  check("AI evaluation quick action present", await page.locator(".dash-start-test").isVisible());

  // The quick action used to dispatch an event nobody listened to, so the
  // button did nothing. Drive it for real: question -> answer -> graded result.
  check("evaluation panel hidden before starting", await page.locator("#dash-test-panel").isHidden());
  await page.locator(".dash-start-test").click();
  await page.locator("#dash-test-panel").waitFor({ state: "visible" });
  await page.locator(".dash-test-question").filter({ hasText: /\S/ }).waitFor({ timeout: 45000 });
  const assessmentQuestion = ((await page.locator(".dash-test-question").textContent()) ?? "").trim();
  check(
    "starting a test returns a diagnostic question",
    assessmentQuestion.length > 20,
    assessmentQuestion.slice(0, 70),
  );
  check(
    "submit becomes available once a question is loaded",
    await page.locator(".dash-test-submit").isEnabled(),
  );
  await page.locator(".dash-test-answer").fill(
    "A source is credible if it was published in a reputable journal, went through peer review, cites evidence, and other teams have replicated it.",
  );
  await page.locator(".dash-test-submit").click();
  await page.locator(".dash-test-result").waitFor({ state: "visible", timeout: 45000 });
  const resultText = ((await page.locator(".dash-test-result").textContent()) ?? "").trim();
  check(
    "submitting an answer yields a score + feedback",
    /%/.test(resultText) && resultText.length > 40,
    resultText.slice(0, 70),
  );
  check(
    "AI test feedback card reflects the new result",
    ((await page.locator(".dash-feedback-body").textContent()) ?? "").trim().length > 20,
  );
  const weakChipCount = await page.locator(".dash-weakpoint").count();
  const weakBody = ((await page.locator(".dash-weakpoints-body").textContent()) ?? "").trim();
  // A good score resolves a weak point, so "no chip" is a legitimate outcome
  // here — what must always hold is that the card agrees with itself.
  check(
    "weak points card is consistent after a graded test",
    weakChipCount > 0 || weakBody.length > 0,
    `${weakChipCount} chip(s)`,
  );
  // NB: the follow-up button lives INSIDE the graded result panel, so it has
  // to be asserted before anything below opens a fresh, ungraded question and
  // closes the panel. Getting this order wrong only showed up once grading
  // started producing weak points, so the chip block became non-empty.
  check(
    "graded result offers a follow-up with the tutor",
    await page.locator(".dash-test-discuss").isVisible(),
  );
  await page.locator(".dash-test-close").click();
  await page.locator("#dash-test-panel").waitFor({ state: "hidden" });
  check("closing the panel hides it again", true);

  if (weakChipCount > 0) {
    // Chips are shortcuts into a test for that exact topic.
    await page.locator(".dash-weakpoint").first().click();
    const questionArrived = await page
      .locator(".dash-test-question")
      .filter({ hasText: /\S/ })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    // Surface the app's own error text: a bare timeout here would hide whether
    // this was a rate limit, a provider outage, or a real UI bug.
    check(
      "clicking a weak point starts a test on that topic",
      questionArrived,
      questionArrived
        ? ((await page.locator(".dash-test-topic").textContent()) ?? "").trim()
        : `status: ${((await page.locator(".dash-status").textContent()) ?? "").trim() || "(none)"}`,
    );
    if (questionArrived) {
      await page.locator(".dash-test-close").click();
      await page.locator("#dash-test-panel").waitFor({ state: "hidden" });
    }
  }

  // Enrollment: the catalog used to render a "Start Learning" button that
  // never enrolled anyone, so progress stayed at 0% forever.
  const firstCard = page.locator(".dash-courses .dash-course").first();
  check(
    "course cards list their modules",
    (await firstCard.locator(".dash-modules li").count()) > 0,
    `${await firstCard.locator(".dash-modules li").count()} modules`,
  );
  check(
    "un-enrolled course offers Start Learning",
    ((await firstCard.locator(".dash-continue").textContent()) ?? "").includes("Start"),
  );
  check("un-enrolled course has no Leave button", (await page.locator(".dash-leave").count()) === 0);

  await page.locator(".dash-search").fill("machine");
  await page.waitForTimeout(150);
  const visibleCourses = await page.locator(".dash-courses .dash-course").count();
  const catalogText = await page.locator(".dash-courses").textContent();
  check(
    "catalog search filters live",
    visibleCourses === 1 && (catalogText ?? "").includes("Machine Learning"),
    `${visibleCourses} result(s)`,
  );
  await page.locator(".dash-search").fill("");
  await page.waitForTimeout(150);
  await page.locator(".dash-courses .dash-course .dash-continue").first().click();
  await page.locator("#chat-container").waitFor({ state: "visible" });
  check("Continue Learning returns to chat with a new question", (await page.locator("#send-button").textContent())?.includes("Thinking") ?? false);
  await page.waitForTimeout(1000); // let the tutor reply or error land
  await page.locator("#dashboard-toggle").click();
  await page.locator("#dashboard-view").waitFor({ state: "visible" });
  check("dashboard can be reopened after returning to chat", true);
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector(".dash-weakpoints-body");
        return !!el && el.textContent.trim() !== "Loading…";
      },
      { timeout: 20000 },
    )
    .catch(() => {});
  check(
    "starting a course enrolled the student",
    (await page.locator(".dash-leave").count()) === 1,
    `${await page.locator(".dash-leave").count()} enrolled`,
  );
  check(
    "enrolled course shows Continue Learning",
    (
      (await page
        .locator(".dash-courses .dash-course .dash-continue")
        .first()
        .textContent()) ?? ""
    ).includes("Continue"),
  );
  // Leaving must return the card to its un-enrolled state.
  await page.locator(".dash-leave").first().click();
  await page
    .waitForFunction(() => document.querySelectorAll(".dash-leave").length === 0, {
      timeout: 10000,
    })
    .catch(() => {});
  check(
    "leaving a course restores Start Learning",
    (await page.locator(".dash-leave").count()) === 0,
  );
  await page.locator("#dashboard-toggle").click();
  await page.locator("#chat-container").waitFor({ state: "visible" });

  // 8. Reload — still signed in, and the conversation comes back from the
  // server. The previous version of this check only asserted the user badge,
  // so it passed while the transcript was silently dropped on every reload.
  // Whether anything was *stored* depends on the tutor provider being up, so
  // ask the API first and only assert restoration when there is something to
  // restore. Skipping loudly beats a green check that proves nothing.
  const storedHistory = await page.evaluate(async () => {
    const username = JSON.parse(localStorage.getItem("agented:user") ?? "{}").username ?? "";
    const res = await fetch(`http://localhost:3000/api/sessions/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("agented:token") ?? ""}` },
    });
    if (!res.ok) return null;
    return (await res.json()).conversationHistory?.length ?? 0;
  });

  await page.reload();
  await page.locator("#app-view").waitFor({ state: "visible" });
  const badgeAfterReload = await page.locator("#user-badge").textContent();
  check("auth persists across reload", badgeAfterReload?.includes(NAME) ?? false);

  if (storedHistory && storedHistory > 0) {
    await page
      .waitForFunction(
        () => document.querySelector("#messages")?.textContent?.includes("Picking up"),
        { timeout: 20000 },
      )
      .catch(() => {});
    const restored = (await page.locator("#messages").textContent()) ?? "";
    check(
      "conversation is restored from the server after reload",
      restored.includes("Picking up"),
      `${storedHistory} stored message(s)`,
    );
    check(
      "restored transcript keeps both speakers",
      (await page.locator("#messages .justify-end").count()) > 0 &&
        (await page.locator("#messages .justify-start").count()) > 0,
    );
  } else {
    console.log(
      `SKIP  restore checks — ${storedHistory ?? "no"} stored message(s) for this run`,
    );
  }

  // 8b. New chat clears the thread on both sides. Always checked: the reset
  // path has to work whether or not there was history to begin with.
  await page.locator("#new-chat-button").click();
  await page
    .waitForFunction(
      () =>
        document.querySelector("#messages")?.textContent?.includes("New conversation started") ===
        true,
      { timeout: 10000 },
    )
    .catch(() => {});
  const afterReset = (await page.locator("#messages").textContent()) ?? "";
  check(
    "new chat clears the visible transcript",
    !afterReset.includes("Picking up") && afterReset.includes("New conversation started"),
  );
  // A reload must NOT bring the cleared history back.
  await page.reload();
  await page.locator("#app-view").waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  const afterResetReload = (await page.locator("#messages").textContent()) ?? "";
  check(
    "cleared history does not come back after reload",
    !afterResetReload.includes("Picking up"),
    afterResetReload.slice(0, 60).replace(/\s+/g, " "),
  );

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

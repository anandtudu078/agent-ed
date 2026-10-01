// The whole first-run workflow, in order, from a pasted link.
//
// Run: node client/scripts/workflow-test.mjs
//
// The other suites each start mid-flow: they open /app.html and assume a known
// state. None of them covers the journey a real person actually takes, which is
// the one thing that broke silently when the root URL became the landing page:
//
//   paste the link  ->  landing page  ->  sign-up  ->  consent  ->  the app
//
// A regression anywhere in that chain shows up here as a step that never
// arrives, which is a clearer failure than a single page misbehaving.
//
// Uses the real backend and the real consent form. The one AI call gets a
// generous window for the same reason as the journey suite: the free tier is
// slow, and slow is not broken.

import { chromium } from "playwright";

import { acceptConsent } from "./test-helpers.mjs";

const FRONTEND = "http://localhost:5173";
// Deliberately the bare origin, NOT /app.html. Landing on the app directly
// would skip the step under test and report a false pass.
const LANDING = FRONTEND;
const USER = `flow${Date.now().toString(36).slice(-6)}`;
const PASS = "flow-pass-123";
const NAME = "Ravi Kumar";
const AI_TIMEOUT = 90000;

let failed = 0;
function check(label, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}
function step(text) {
  console.log(`\n--- ${text}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // Console errors and failed requests are collected but only *reported*: a
  // favicon 404 is not a broken workflow, and failing the run over one would
  // train people to ignore this suite.
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140));
  });
  const badResponses = [];
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 100)}`);
  });

  // ------------------------------------------------- 1. land on the landing page
  step("1. Pasting the link lands on the landing page");
  await page.goto(LANDING);
  // The sign-in form must be absent, not merely hidden. This is the assertion
  // that would have caught the app sitting at the root URL.
  check("the root URL is not the sign-in screen", (await page.locator("#auth-view").count()) === 0);
  check("the landing page renders its headline", await page.locator("h1").first().isVisible());
  const cta = page.locator('a[href="/app.html"], a[href="app.html"]').first();
  check("the landing page invites you into the app", (await cta.count()) > 0);

  // ------------------------------------------------------- 2. CTA -> sign-up
  step("2. Following the call to action reaches the sign-up page");
  await cta.click();
  await page.waitForURL(/\/app\.html/);
  await page.waitForFunction(() => window.__agentedTest !== undefined);
  check("the tutor app opened", page.url().includes("/app.html"));
  check("the sign-in screen is showing", await page.locator("#auth-view").isVisible());
  check("the app itself is still hidden", !(await page.locator("#app-view").isVisible()));
  check("it opens in sign-in mode", await page.locator("#display-name-input").isHidden());

  // --------------------------------------------------------- 3. register
  step("3. Registering a new account");
  await page.locator("#auth-toggle").click();
  await page.locator("#display-name-input").fill(NAME);
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.locator("#auth-submit").click();
  // Consent is the next required step, and it lives inside the auth view, so
  // this is the handoff from "registering" to "letting you in".
  await page.locator("#consent-view").waitFor({ state: "visible", timeout: 20000 });
  check("registration is followed by the consent notice", true);
  check("the app is NOT reachable before consent", !(await page.locator("#app-view").isVisible()));
  const disclosure = await page.locator("#consent-disclosure li").count();
  check("the privacy disclosure actually rendered", disclosure > 0, `${disclosure} lines`);

  // --------------------------------------------------------- 4. consent -> app
  step("4. Giving consent lands the student in the app");
  await acceptConsent(page);
  check("the app is now visible", await page.locator("#app-view").isVisible());
  check("the sign-in screen is gone", !(await page.locator("#auth-view").isVisible()));
  check(
    "the student sees their own name",
    ((await page.locator("#user-badge").textContent()) ?? "").includes(NAME),
  );
  await page.locator("#status-text").filter({ hasText: "Online" }).waitFor({ timeout: 30000 });
  check("the live socket connected", true);
  // ------------------------------------------------------ 5. it actually works
  step("5. The homepage is functional");
  check(
    "the owl greets the student",
    (((await page.locator("#owl-stage .owl-message").textContent()) ?? "").length > 15),
  );
  check("starting points are offered", (await page.locator(".suggestion-chip").count()) > 0);
  await page.locator("#message-input").fill("What is a derivative?");
  await page.locator("#send-button").click();
  const TUTOR_BODY = "#messages > .flex.justify-start > div > p:last-child";
  await page.locator(TUTOR_BODY).filter({ hasText: /\S/ }).first().waitFor({ timeout: AI_TIMEOUT });
  const reply = (await page.locator(TUTOR_BODY).first().textContent()) ?? "";
  check("a real tutor reply arrives", reply.length > 40, `${reply.length} chars`);
  check("it asks the student something back", reply.includes("?"), "Socratic reply");

  // ------------------------------------------------ 6. the dashboard opens
  step("6. The dashboard opens");
  await page.locator("#dashboard-toggle").click();
  await page.locator("#dashboard-view").waitFor({ state: "visible", timeout: 20000 });
  check("the learning dashboard is reachable", await page.locator("#dashboard-view").isVisible());

  // ------------------------------------- 6b. a course opens into its full detail
  //
  // The detail dialog is the step between "I picked a course" and "I am learning
  // it", and it is the only place subtopics are ever shown. Asserted here rather
  // than in the UI suite because this suite is the one that walks the real path a
  // person takes, so a detail view that renders but is unreachable from the card
  // would still be caught.
  step("6b. Opening a course shows its topics and subtopics");
  await page.locator(".dash-courses .dash-course").first().waitFor({ timeout: 20000 });
  const card = page.locator(".dash-courses .dash-course").first();
  const courseTitle = ((await card.locator("h3").textContent()) ?? "").trim();
  check("the card is for a real course", courseTitle.length > 0, courseTitle);

  // Nothing may be shown before it is asked for: an always-open dialog would
  // cover the dashboard the moment the student signed in.
  check("no course detail is open on arrival", !(await page.locator(".course-detail").isVisible()));

  await card.locator(".dash-details").click();
  await page.locator(".course-detail:not(.hidden)").waitFor({ timeout: 10000 });
  check("clicking Details opens the course", await page.locator(".course-detail").isVisible());
  check(
    "the dialog is for the course that was clicked",
    ((await page.locator(".course-detail-title").textContent()) ?? "").trim() === courseTitle,
    courseTitle,
  );

  const detailModules = await page.locator(".course-detail-module").count();
  const detailSubtopics = await page.locator(".course-detail-subtopics").count();
  // A module with no curated breakdown still renders its title, so this asserts
  // the list exists rather than that every module has one.
  check("the full syllabus is listed", detailModules > 0, `${detailModules} modules`);
  check(
    "modules list their subtopics",
    detailSubtopics >= detailModules,
    `${detailSubtopics} subtopic lists across ${detailModules} modules`,
  );
  const firstModule = ((await page.locator(".course-detail-module").first().textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  check(
    "a subtopic is real text, not a placeholder",
    firstModule.length > 20,
    firstModule.slice(0, 60),
  );

  // Escape has to work, and it has to leave the student on the dashboard.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes the course detail", !(await page.locator(".course-detail").isVisible()));
  check("closing it returns to the course list", await page.locator("#dashboard-view").isVisible());

  // Reopening and pressing Start is the whole point of the feature: read the
  // syllabus, then begin. Asserted through to the chat, because a Start button
  // that closes the dialog without enrolling would look identical until the
  // student noticed they had no course.
  step("6c. Starting the course from its detail view");
  await card.locator(".dash-details").click();
  await page.locator(".course-detail:not(.hidden)").waitFor({ timeout: 10000 });
  const startLabel = ((await page.locator(".course-detail-start").textContent()) ?? "").trim();
  check("the detail view offers a way to start", startLabel.length > 0, startLabel);
  await page.locator(".course-detail-start").click();
  await page.locator("#chat-container").waitFor({ state: "visible", timeout: 20000 });
  check("starting from the detail view opens the tutor", await page.locator("#chat-container").isVisible());
  check(
    "the dialog is gone once the lesson begins",
    !(await page.locator(".course-detail").isVisible().catch(() => false)),
  );
  const firstMessage = ((await page.locator("#messages").textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  check(
    "the tutor was aimed at the chosen course",
    firstMessage.includes(courseTitle),
    courseTitle,
  );

  // Back to the dashboard: the course must now read as enrolled, which is what
  // proves the enrolment actually persisted rather than just the chat opening.
  await page.locator("#dashboard-toggle").click();
  await page.locator("#dashboard-view").waitFor({ state: "visible", timeout: 20000 });
  await page
    .waitForFunction(() => document.querySelectorAll(".dash-leave").length > 0, { timeout: 20000 })
    .catch(() => {});
  check("starting from the detail view enrolled the student", (await page.locator(".dash-leave").count()) > 0);
  const enrolledCard = page.locator(".dash-course", { hasText: courseTitle }).first();
  check(
    "the card now offers Continue",
    ((await enrolledCard.locator(".dash-continue").textContent()) ?? "").includes("Continue"),
  );
  await enrolledCard.locator(".dash-details").click();
  await page.locator(".course-detail:not(.hidden)").waitFor({ timeout: 10000 });
  const resumeLabel = ((await page.locator(".course-detail-start").textContent()) ?? "").trim();
  check(
    "reopening names the module it will resume into",
    resumeLabel.includes("Continue with") || resumeLabel.includes("Review"),
    resumeLabel,
  );
  await page.keyboard.press("Escape");

  // ------------------------------------------- 7. sign out lands back on login
  step("7. Signing out returns to the login screen");
  await page.locator("#sign-out-button").click();
  await page.locator("#auth-view").waitFor({ state: "visible", timeout: 20000 });
  check("the sign-in screen is back", await page.locator("#auth-view").isVisible());
  check("the app is hidden again", !(await page.locator("#app-view").isVisible()));
  check(
    "the credentials were cleared, not left for the next person",
    (await page.locator("#password-input").inputValue()) === "" &&
      (await page.locator("#username-input").inputValue()) === "",
    "username and password both empty",
  );

  // ----------------------------------------- 8. a reload stays signed out
  step("8. A reload does not silently sign the student back in");
  await page.reload();
  await page.waitForFunction(() => window.__agentedTest !== undefined);
  await page.waitForTimeout(1500);
  check("still on the sign-in screen after reload", await page.locator("#auth-view").isVisible());
  check("the app did not reopen", !(await page.locator("#app-view").isVisible()));

  // ----------------------------------------- 9. signing back in works
  step("9. Signing back in with the same account");
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.locator("#auth-submit").click();
  // Consent is already on file, so a returning student must NOT be asked again.
  await page.locator("#app-view").waitFor({ state: "visible", timeout: 25000 });
  check("returning student goes straight in", true);
  const consentShown = await page.locator("#consent-view").isVisible().catch(() => false);
  check("a returning student is not re-asked for consent", !consentShown);

  // ------------------------------------------------------- noise report
  if (consoleErrors.length) {
    console.log(`\n  console errors (${consoleErrors.length}):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 8)) console.log(`    · ${e}`);
  }
  if (badResponses.length) {
    console.log(`  failed requests (${badResponses.length}):`);
    for (const r of [...new Set(badResponses)].slice(0, 8)) console.log(`    · ${r}`);
  }
} catch (error) {
  failed += 1;
  console.log(`\nFAIL  the workflow broke: ${error.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
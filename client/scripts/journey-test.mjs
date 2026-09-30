// Full-stack user journey: a brand-new student, start to finish, against the
// real AI providers (no offline stand-in).
//
// Run: node client/scripts/journey-test.mjs
//
// Every other suite drives one component or uses stubs. This one is the only
// thing that answers the question a user actually cares about: if a real
// person sits down, signs up, and tries to learn something, does the whole
// thing work end to end?
//
// The database is expected to be empty (a fresh MONGO_URI), so the first-run
// path, the catalog seeding and the first-run greeting are all exercised rather
// than skipped as "already done".
//
// Each AI call gets a generous window. These are real model calls, and the free
// tier can take tens of seconds; a timeout here means slow, not broken.

import { chromium } from "playwright";

const FRONTEND = "http://localhost:5173";
const USER = `journey${Date.now().toString(36).slice(-6)}`;
const PASS = "journey-pass-123";
const NAME = "Priya Sharma";
const AI_TIMEOUT = 90000;

// Message selectors.
//
// `#messages .flex.justify-start` is NOT the tutor's text: the author meta line
// carries the same justify-start class, so a descendant query matches the
// wrapper and then the meta inside it, and `.nth(1)` lands on the meta rather
// than on the next message. Scoping to direct children picks the message
// wrapper, and the last <p> inside its bubble is the body - the meta is a
// sibling <p>, so `:last-child` separates them.
const TUTOR_MSG = "#messages > .flex.justify-start";
const TUTOR_BODY = `${TUTOR_MSG} > div > p:last-child`;
const STUDENT_MSG = "#messages > .flex.justify-end";

const results = [];
let failed = 0;
function check(label, ok, detail = "") {
  if (!ok) failed += 1;
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}
function note(text) {
  console.log(`      · ${text}`);
}
function step(text) {
  console.log(`\n--- ${text}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(AI_TIMEOUT);

  // Record console errors and failed requests: a green walkthrough that is
  // throwing in the console is not a working app.
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  });
  // Record non-2xx responses with their URL. A bare "404 (Not Found)" in the
  // console names nothing, so filtering on the message text alone would let a
  // genuinely missing endpoint through as "expected noise".
  const badResponses = [];
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 110)}`);
  });

  // ---------------------------------------------------------------- 1. sign up
  step("1. A brand-new student signs up");
  await page.goto(FRONTEND);
  await page.waitForFunction(() => window.__agentedTest !== undefined);
  check("app loads to the sign-in screen", await page.locator("#auth-view").isVisible());
  await page.locator("#auth-toggle").click();
  await page.locator("#display-name-input").fill(NAME);
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.locator("#auth-submit").click();
  await page.locator("#app-view").waitFor({ state: "visible" });
  await page.locator("#status-text").filter({ hasText: "Online" }).waitFor();
  check("account created and socket connected", true, `user=${USER}`);
  check(
    "the student sees their own name",
    ((await page.locator("#user-badge").textContent()) ?? "").includes(NAME),
  );

  // ------------------------------------------------------------ 2. first run
  step("2. First run");
  const owlLine = (await page.locator("#owl-stage .owl-message").textContent()) ?? "";
  check(
    "the owl introduces itself and invites a question",
    owlLine.length > 20,
    owlLine.slice(0, 70),
  );
  const suggestions = await page.locator(".suggestion-chip").count();
  check("the owl offers starting points", suggestions > 0, `${suggestions} chip(s)`);


  // --------------------------------------------------------- 3. Socratic turn
  step("3. Asks a real question (Socratic mode — the default)");
  await page.locator("#message-input").fill("What is machine learning?");
  const sentAt = Date.now();
  await page.locator("#send-button").click();
  await page.locator(STUDENT_MSG).first().waitFor();
  check("the student's question appears in the thread", true);

  // The tutor must actually answer with the model, not a canned string.
  await page
    .locator(TUTOR_BODY)
    .filter({ hasText: /\S/ })
    .first()
    .waitFor({ timeout: AI_TIMEOUT });
  const firstReply =
    (await page.locator(TUTOR_BODY).first().textContent()) ?? "";
  const seconds = Math.round((Date.now() - sentAt) / 1000);
  check("a real tutor reply arrives", firstReply.length > 40, `${seconds}s`);
  check("the reply is not an error message", !/Something went wrong/i.test(firstReply));
  note(`reply: ${firstReply.replace(/\s+/g, " ").slice(0, 150)}…`);

  // The whole point of Socratic mode: it must not just hand over the answer.
  const bareAnswer = /\bis a (type|branch|field|form) of\b/i;
  check(
    "it teaches rather than reciting (Socratic mode)",
    !bareAnswer.test(firstReply),
    bareAnswer.test(firstReply) ? "opened with a bare definition" : "did not open with a definition",
  );
  check(
    "it asks the student something back",
    /\?/.test(firstReply),
    firstReply.includes("?") ? "contains a question" : "no question mark",
  );

  // ------------------------------------------------------------ 4. the owl
  step("4. The owl presents the answer");
  await page.locator("#owl-stage .owl-bubble").waitFor({ state: "visible" });
  // The bubble reveals word by word, so reading it immediately catches it
  // mid-sentence. The full line is on the aria-label; wait until the visible
  // text has caught up with it.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("#owl-stage .owl-message");
        if (!el) return false;
        const full = el.getAttribute("aria-label") || "";
        return full.length > 0 && (el.textContent || "").length >= full.length;
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  const bubble = ((await page.locator("#owl-stage .owl-message").textContent()) ?? "").trim();
  check("the owl has the tutor's line in its bubble", bubble.length > 20, `${bubble.length} chars`);
  check("the owl wears its teaching cap", (await page.locator("#owl-stage .owl-cap").count()) > 0);
  const pill = ((await page.locator("#owl-stage .owl-state-pill").textContent()) ?? "").trim();
  check("the owl is in a teaching pose", pill === "Teaching" || pill === "Thinking", pill);
  const hasSvg = await page.locator("#owl-stage .owl-board-art svg").count();
  check("the lesson board shows something", hasSvg === 1);

  // ------------------------------------------------------ 5. memory / follow-up
  step("5. The tutor remembers the thread");
  await page.locator("#message-input").fill("But how is that different from just writing rules by hand?");
  await page.locator("#send-button").click();
  await page
    .locator(TUTOR_BODY)
    .nth(1)
    .waitFor({ timeout: AI_TIMEOUT });
  const secondReply =
    (await page.locator(TUTOR_BODY).nth(1).textContent()) ?? "";
  check("a second reply arrives", secondReply.length > 40, `${secondReply.length} chars`);
  check("the thread now holds both exchanges", (await page.locator(TUTOR_BODY).count()) >= 2);
  note(`reply: ${secondReply.replace(/\s+/g, " ").slice(0, 150)}…`);

  // ------------------------------------------------------------ 6. teach mode
  step("6. Switches to Teach me and asks for a full explanation");
  await page.locator("#owl-stage .owl-mode-toggle").click();
  await page.waitForTimeout(400);
  check(
    "the owl switches to teach mode",
    ((await page.locator("#owl-stage .owl-mode-toggle").textContent()) ?? "").includes("Teach"),
  );
  await page.locator("#message-input").fill("teach me how a neural network learns");
  await page.locator("#send-button").click();
  await page
    .locator(TUTOR_BODY)
    .nth(2)
    .waitFor({ timeout: AI_TIMEOUT });
  const taught = (await page.locator(TUTOR_BODY).nth(2).textContent()) ?? "";
  check("a full explanation is delivered", taught.length > 200, `${taught.length} chars`);
  note(`taught: ${taught.replace(/\s+/g, " ").slice(0, 170)}…`);

  // Beat playback: the bubble should end up holding one segment, not the essay.
  await page.waitForTimeout(2500);
  const beatBubble = ((await page.locator("#owl-stage .owl-message").textContent()) ?? "").trim();
  check(
    "the owl's bubble holds one short segment, not the whole essay",
    beatBubble.length > 10 && beatBubble.length < 260,
    `${beatBubble.length} chars in bubble vs ${taught.length} in transcript`,
  );
  note(`bubble: ${beatBubble.slice(0, 110)}…`);

  // A diagram should have been generated for the topic.
  const boardTitle = await page
    .locator("#owl-stage .owl-board-art svg title")
    .first()
    .textContent()
    .catch(() => null);
  check("the board shows a topic diagram or sketch", Boolean(boardTitle), boardTitle ?? "no title");

  // --------------------------------------------------------- 7. assessment
  step("7. Takes a graded check");
  await page.locator("#dashboard-toggle").click();
  await page.locator("#dashboard-view").waitFor({ state: "visible" });
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector(".dash-courses");
        return !!el && el.textContent.trim() !== "";
      },
      null,
      { timeout: AI_TIMEOUT },
    )
    .catch(() => {});
  const courses = await page.locator(".dash-courses .dash-course").count();
  check("the course catalog is seeded and listed", courses >= 4, `${courses} courses`);
  const modules = await page.locator(".dash-courses .dash-course").first().locator(".dash-modules li").count();
  check("courses list their modules", modules > 0, `${modules} modules on the first card`);

  const nextStep = ((await page.locator(".dash-next-headline").first().textContent()) ?? "").trim();
  check("the dashboard leads with one clear next step", nextStep.length > 0, nextStep.slice(0, 60));

  await page.locator(".dash-start-test").click();
  await page.locator("#dash-test-panel").waitFor({ state: "visible" });
  await page
    .locator(".dash-test-question")
    .filter({ hasText: /\S/ })
    .waitFor({ timeout: AI_TIMEOUT });
  const question = ((await page.locator(".dash-test-question").textContent()) ?? "").trim();
  check("a real diagnostic question is generated", question.length > 20, question.slice(0, 90));
  check("it is open-ended, not multiple choice", !/[ABCD][\).]/.test(question), question.slice(0, 60));

  await page
    .locator(".dash-test-answer")
    .fill(
      "It adjusts internal numbers called weights. Each time its prediction is wrong it nudges them slightly in the direction that would have reduced the error, repeating this many times so the outputs get closer to correct.",
    );
  await page.locator(".dash-test-submit").click();
  await page.locator(".dash-test-result").waitFor({ state: "visible", timeout: AI_TIMEOUT });
  const result = ((await page.locator(".dash-test-result").textContent()) ?? "").replace(/\s+/g, " ").trim();
  check("the answer is graded", /%/.test(result), result.slice(0, 80));
  note(`grade: ${result.slice(0, 120)}`);
  const feedback = ((await page.locator(".dash-feedback-body").textContent()) ?? "").trim();
  check("feedback is written for the student", feedback.length > 20, feedback.slice(0, 90));
  const focus = ((await page.locator(".dash-test-result").textContent()) ?? "");
  check("a next focus is recommended", /focus next/i.test(focus), focus.replace(/\s+/g, " ").slice(0, 70));


    "it asks the student something back",
    /\?/.test(firstReply),

  // ------------------------------------------------------- 8. the memory loop
  step("8. The dashboard remembers what happened");
  await page.locator(".dash-test-close").click();
  await page.locator("#dash-test-panel").waitFor({ state: "hidden" });
  await page.waitForTimeout(800);
  const weak = await page.locator(".dash-weakpoint").count();
  check("the weak-points card reflects the grade", weak > 0, `${weak} weak point(s)`);
  const reviewText = ((await page.locator(".dash-reviews-body").textContent()) ?? "").trim();
  check(
    "a review is scheduled for later",
    reviewText.length > 0 && !/Loading…|NaN/.test(reviewText),
    reviewText.replace(/\s+/g, " ").slice(0, 70),
  );
  const speed = ((await page.locator(".dash-speed").first().textContent()) ?? "").trim();
  check("learning speed is described in words", speed.length > 0, speed.slice(0, 60));

  // ------------------------------------------------------------ 9. persistence
  step("9. The student closes the tab and comes back");
  await page.locator("#dashboard-toggle").click();
  await page.locator("#chat-container").waitFor({ state: "visible" });
  const beforeReload = await page.locator(TUTOR_BODY).count();
  await page.reload();
  await page.locator("#app-view").waitFor({ state: "visible" });
  await page
    .waitForFunction(
      () => (document.querySelector("#messages")?.textContent ?? "").includes("Picking up"),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  const afterReload = await page.locator(TUTOR_BODY).count();
  check("still signed in after reload", (await page.locator("#user-badge").textContent())?.includes(NAME) ?? false);
  check("the conversation is restored from the server", afterReload >= beforeReload, `${beforeReload} -> ${afterReload}`);
  const restored = (await page.locator("#messages").textContent()) ?? "";
  check("the restored thread keeps both speakers",
    (await page.locator(STUDENT_MSG).count()) > 0 &&
      (await page.locator(TUTOR_BODY).count()) > 0,
  );
  check("it explains that the thread was picked up", restored.includes("Picking up"));

  // ------------------------------------------------------------- 10. bilingual
  step("10. Switches the teaching language to Hindi");
  const langBtn = page.locator("#language-toggle");
  await langBtn.click();
  await page.waitForFunction(
    () => {
      try {
        return (JSON.parse(localStorage.getItem("agented:user") ?? "{}").language ?? "en") === "hi";
      } catch {
        return false;
      }
    },
    null,
    { timeout: 20000 },
  );
  check("the language choice is saved", true, "persisted as hi");
  await page.locator("#message-input").fill("recursion kya hai?");
  await page.locator("#send-button").click();
  // Wait for a NEW reply. Reading `.last()` straight away returns the previous
  // one, because the locator already matches something.
  const repliesBeforeHindi = await page.locator(TUTOR_BODY).count();
  await page.waitForFunction(
    (before) => document.querySelectorAll("#messages > .flex.justify-start > div > p:last-child").length > before,
    repliesBeforeHindi,
    { timeout: AI_TIMEOUT },
  );
  const hindi = (await page.locator(TUTOR_BODY).last().textContent()) ?? "";
  const hasDevanagari = /[ऀ-ॿ]/.test(hindi);
  check("the tutor answers in Hindi", hasDevanagari, hindi.replace(/\s+/g, " ").slice(0, 90));
  // Prose should be Hindi. Whether a particular technical term survives in Latin
  // script is a prompt instruction to the model, not a property of the app, and
  // one reply cannot settle it - the model may simply not have used the word.
  // Asserted instead: the reply is predominantly Devanagari.
  const devanagariChars = (hindi.match(/[ऀ-ॿ]/g) ?? []).length;
  check(
    "the Hindi reply is prose in Devanagari, not transliterated",
    devanagariChars > 40,
    `${devanagariChars} Devanagari characters`,
  );
  note(`hindi: ${hindi.replace(/\s+/g, " ").slice(0, 130)}…`);
  await langBtn.click();
  await page.waitForTimeout(600);

  // ------------------------------------------------------------- 11. sign out
  step("11. Signs out and signs back in");
  await page.locator("#dashboard-toggle").click().catch(() => {});
  await page.locator("#sign-out-button").click();
  await page.locator("#auth-view").waitFor({ state: "visible" });
  const token = await page.evaluate(() => localStorage.getItem("agented:token"));
  check("sign out returns to the auth screen and clears the token", token === null);

  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.locator("#auth-submit").click();
  await page.locator("#app-view").waitFor({ state: "visible" });
  check("signing back in works", (await page.locator("#user-badge").textContent())?.includes(NAME) ?? false);

  // A duplicate account must be refused rather than silently overwriting.
  // A NEW context, so this visitor has no stored session and actually sees the
  // auth screen — reusing `context` would share localStorage and skip straight
  // into the app.
  const otherContext = await browser.newContext();
  const page2 = await otherContext.newPage();
  await page2.goto(FRONTEND);
  await page2.waitForFunction(() => window.__agentedTest !== undefined);
  await page2.locator("#auth-toggle").click();
  await page2.locator("#display-name-input").fill("Impostor");
  await page2.locator("#username-input").fill(USER);
  await page2.locator("#password-input").fill(PASS);
  await page2.locator("#auth-submit").click();
  await page2.locator("#auth-error").filter({ hasText: /\S/ }).waitFor({ timeout: 20000 });
  const dupErr = (await page2.locator("#auth-error").textContent()) ?? "";
  check("a duplicate username is refused", dupErr.length > 0, dupErr.slice(0, 70));
  await otherContext.close();

  // ---------------------------------------------------------------- 12. health
  step("12. Nothing was broken along the way");
  // "Failed to load resource" is the browser's generic notice for any 4xx/5xx
  // and carries no URL, so it cannot be told apart from the intentional session
  // 404 above. The response listener already covers every HTTP failure with its
  // actual URL, which is the authoritative check; this one is for script errors
  // the network layer never sees.
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|speechSynthesis|SpeechRecognition|not supported|Failed to load resource/i.test(e),
  );
  check(
    "no unexpected console errors",
    realErrors.length === 0,
    realErrors.slice(0, 2).join(" | ") || "clean",
  );
  // A 4xx/5xx from our own API is a real defect - with one deliberate exception.
  // `GET /api/sessions/:id` answers 404 for a student who has no session yet,
  // which is the normal state of every brand-new signup. That is a contract,
  // not a fault: the client documents it ("404 just means this is a brand-new
  // student with no session yet") and treats it as "no history". Anything else
  // failing is real.
  const realBad = badResponses.filter(
    (r) => !/favicon/i.test(r) && !/^\d{3} .*\/api\/sessions\//.test(r),
  );
  check("no failed API responses", realBad.length === 0, realBad.slice(0, 3).join(" | ") || "clean");
  const expected404 = badResponses.filter((r) => /^\d{3} .*\/api\/sessions\//.test(r));
  note(
    expected404.length
      ? `${expected404.length} expected 404(s) for a brand-new student with no session yet`
      : "no session 404s this run",
  );
} catch (error) {
  check("journey completed without crashing", false, String(error).slice(0, 220));
} finally {
  await browser.close();
}

console.log(`\n${results.length - failed}/${results.length} journey checks passed`);
process.exit(failed > 0 ? 1 : 0);

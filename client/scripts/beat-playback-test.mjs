// Live browser test for the owl's BEAT playback — the "wall of text" fix.
//
// Run: node client/scripts/beat-playback-test.mjs
//
// The unit suite (client/scripts/beats-test.ts) proves a reply is CUT correctly.
// It says nothing about whether the browser then plays those cuts one at a time —
// which is the part that actually regressed, because the failure mode is silent:
// one utterance instead of five looks almost identical in code review and is
// exactly the "reads me a wall of text" complaint in the product.
//
// So this drives the real client path in a real browser, with speechSynthesis
// stubbed to fire its own events, and watches what the student would see.
//
// speechSynthesis is stubbed rather than relied on for two reasons: headless
// Chromium has no voices (so nothing would ever speak, and every await would
// hang), and we need each utterance's lifetime under our control to prove the
// calls are sequential instead of overlapping.

import { chromium } from "playwright";

const FRONTEND = "http://localhost:5173";
const USER = `beat${Date.now().toString(36).slice(-5)}`;
const PASS = "beat-pass-123";
const NAME = "Beat Tester";

// A teach-mode reply in the shape that caused the complaint: several sentences
// of prose plus a closing check-for-understanding question.
const LONG_REPLY =
  "Machine learning is a way for computers to learn patterns from examples rather than being handed every rule. " +
  "Think of it like teaching a child to recognise a cat. " +
  "For example, to spot spam you might show a model ten thousand emails. " +
  "The model adjusts its internal numbers a little each time it guesses wrong. " +
  "The caveat people miss is that the model only knows what it was shown. " +
  "What kind of email would you guess the model might wrongly call spam?";

// A second reply, built so each concrete noun lands in its own beat. The board
// and the sentence are checked together, so the beats must not be merged.
const SKETCH_REPLY =
  "Think of it like teaching a child to recognise a cat. " +
  "You show many photos of cats, and they work out what matters. " +
  "Now imagine that child looking at an email inbox instead. " +
  "The model reads each email and learns which ones are spam. " +
  "It guesses, checks, and adjusts. " +
  "What would you guess it gets wrong first?";

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // --- Stub the speech engine BEFORE any app code runs -------------------
  // Records a timeline of every speak() so we can assert both what was said
  // and *when*. Firing onend from a timer is what makes the real sequential
  // await path observable at all.
  await page.addInitScript(() => {
    const log = [];
    let live = 0;
    let maxLive = 0;
    const synth = {
      speak(u) {
        live += 1;
        maxLive = Math.max(maxLive, live);
        // Capture what the board is showing at the instant this utterance
        // begins. Sampling the board from the test loop instead would race the
        // owl's playback and intermittently miss a beat entirely — which is
        // exactly what a screenshot-style poll did here.
        const art = document.querySelector("#owl-stage .owl-board-art");
        const entry = {
          text: String(u.text),
          start: performance.now(),
          end: null,
          boardLabel: art?.querySelector("title")?.textContent ?? "",
        };
        log.push(entry);
        setTimeout(() => u.onstart?.(), 10);
        // ~45ms per "word" keeps the run a few seconds without being instant.
        const words = String(u.text).split(/\s+/).filter(Boolean).length;
        setTimeout(
          () => {
            entry.end = performance.now();
            live -= 1;
            u.onend?.();
          },
          Math.max(60, words * 45),
        );
      },
      cancel() {},
      pause() {},
      resume() {},
      getVoices: () => [{ lang: "en-US", name: "stub" }],
      addEventListener() {},
      removeEventListener() {},
    };
    class FakeUtterance {
      constructor(text) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "speechSynthesis", {
      get: () => synth,
      configurable: true,
    });
    window.SpeechSynthesisUtterance = FakeUtterance;
    window.__tts = {
      log,
      maxLive: () => maxLive,
      reset() {
        log.length = 0;
        maxLive = 0;
      },
    };
  });



  await page.goto(FRONTEND);
  await page.waitForFunction(() => window.__agentedTest !== undefined);

  // --- Register -----------------------------------------------------------
  await page.locator("#auth-view").waitFor({ state: "visible" });
  await page.locator("#auth-toggle").click();
  await page.locator("#display-name-input").fill(NAME);
  await page.locator("#username-input").fill(USER);
  await page.locator("#password-input").fill(PASS);
  await page.locator("#auth-submit").click();
  await page.locator("#app-view").waitFor({ state: "visible" });
  await page.locator("#status-text").filter({ hasText: "Online" }).waitFor();
  check("registered and connected", true, `user=${USER}`);
  await page.waitForTimeout(400);

  // --- Drive the real reply path with a long answer ------------------------
  // simulateReply runs handleSocraticResponse, the same function a live tutor
  // reply goes through, so this exercises the production sequencing.
  await page.evaluate((reply) => {
    window.__tts.reset();
    window.__agentedTest.simulateReply(reply);
  }, LONG_REPLY);

  // The bubble must NOT already hold the whole essay. This is the single
  // assertion that would have caught the original bug.
  const early = await page.locator("#owl-stage .owl-message").textContent();
  check(
    "the bubble does not start as the whole essay",
    (early?.length ?? 0) < 120,
    `${early?.length ?? 0} chars: ${(early ?? "").slice(0, 48)}…`,
  );

  // --- Watch the bubble change over time -----------------------------------
  // Samples repeatedly and records each distinct value. If the owl were still
  // doing one long utterance, this would stay a single sample.
  const samples = [];
  for (let i = 0; i < 40; i += 1) {
    const text = (await page.locator("#owl-stage .owl-message").textContent()) ?? "";
    if (!samples.length || samples[samples.length - 1] !== text) samples.push(text);
    const done = await page.evaluate(() => window.__tts.log.length >= 5);
    if (done && i > 6) break;
    await page.waitForTimeout(150);
  }
  check(
    "the bubble advances through several segments",
    samples.length >= 3,
    `${samples.length} distinct texts`,
  );

  // --- Assert on what was actually spoken ----------------------------------
  const spoken = await page.evaluate(() => window.__tts.log.map((e) => e.text));

  check(
    "the essay is spoken as multiple utterances, not one",
    spoken.length >= 3,
    `${spoken.length} utterances`,
  );

  // Never more than one utterance alive at a time: this is what proves the
  // playback is sequential (awaiting each end) rather than queued in parallel.
  const maxLive = await page.evaluate(() => window.__tts.maxLive());
  check("utterances never overlap", maxLive === 1, `max concurrent=${maxLive}`);

  // The whole point: with beat playback disabled the reply must come back as a
  // SINGLE long utterance, and the bubble must hold the entire essay at once.
  // This is the regression the feature exists to prevent, so assert the old
  // behaviour explicitly — a test that cannot fail here proves nothing.
  await page.evaluate((reply) => {
    window.__tts.reset();
    window.__agentedTest.forceSingleUtterance(true);
    window.__agentedTest.simulateReply(reply);
  }, LONG_REPLY);
  // Wait for the bubble's word-by-word reveal to finish rather than sampling it
  // mid-reveal — at 400ms it has only typed a few words, which would make the
  // "holds the whole essay" assertion below pass or fail for the wrong reason.
  await page.waitForFunction(
    () => (document.querySelector("#owl-stage .owl-message")?.textContent?.length ?? 0) > 200,
    null,
    { timeout: 15000 },
  );
  const oldBubble = await page.locator("#owl-stage .owl-message").textContent();
  await page.waitForTimeout(1200);
  const oldSpoken = await page.evaluate(() => window.__tts.log.map((e) => e.text));
  await page.evaluate(() => {
    window.__agentedTest.forceSingleUtterance(false);
  });
  check(
    "CONTROL: without beats the reply is one utterance",
    oldSpoken.length === 1,
    `${oldSpoken.length} utterance(s)`,
  );
  check(
    "CONTROL: without beats the bubble holds the whole essay",
    (oldBubble?.length ?? 0) > 200,
    `${oldBubble?.length ?? 0} chars`,
  );
  check(
    "so the beat assertions above are meaningful (beats really did split it)",
    spoken.length > oldSpoken.length,
    `${spoken.length} with beats vs ${oldSpoken.length} without`,
  );

  const firstWords = spoken[0]?.split(/\s+/).slice(0, 3).join(" ") ?? "";
  check(
    "the first beat opens the explanation",
    /machine learning is/i.test(firstWords),
    firstWords,
  );
  check(
    "the closing question is spoken last",
    /wrongly call spam\?$/.test((spoken[spoken.length - 1] ?? "").trim()),
    (spoken[spoken.length - 1] ?? "").slice(-46),
  );

  const longest = Math.max(...spoken.map((t) => t.split(/\s+/).filter(Boolean).length));
  check("no spoken segment is over 32 words", longest <= 32, `longest=${longest}`);

  // Lossless: the cut must not have dropped content.
  const joined = spoken.join(" ").toLowerCase();
  const keyIdeas = ["child", "spam", "internal numbers", "caveat"];
  const missing = keyIdeas.filter((k) => !joined.includes(k));
  check("every idea is still spoken", missing.length === 0, missing.join(",") || "all present");

  // --- The full reply is still in the transcript ---------------------------
  // The bubble shows one beat; the chat below must still hold everything, or we
  // have thrown away the student's lesson to make the owl look nicer.
  const transcript = (await page.locator("#chat-container").textContent()) ?? "";
  check(
    "the full reply is still in the transcript",
    transcript.includes("Machine learning is a way for computers"),
  );

  // --- Interruption: a new beat must not talk over the student -------------
  // Cancelling mid-playthrough used to leave the gap timer alive, which resumed
  // the loop and the owl kept talking over whatever the student typed next.
  await page.evaluate(() => window.__tts.reset());
  await page.evaluate((reply) => window.__agentedTest.simulateReply(reply), LONG_REPLY);
  await page.waitForTimeout(500);
  const beforeStop = await page.evaluate(() => window.__tts.log.length);
  await page.locator("#message-input").fill("wait, what?");
  await page.locator("#message-input").press("Enter");
  await page.waitForTimeout(1800);
  const afterStop = await page.evaluate(() => window.__tts.log.length);
  check(
    "the owl stops talking when the student interrupts",
    afterStop <= beforeStop + 1,
    `spoke ${beforeStop} before, ${afterStop} after`,
  );

  // --- Sketches: the picture must match the sentence ---------------------
  // The claim is "if it says cat, show a cat" — which is a claim about two
  // things moving TOGETHER, so it is checked by pairing each spoken beat with
  // whatever the board showed when that beat began. The speech stub records
  // that pairing, so this cannot race the playback the way a poll does.
  await page.evaluate(() => window.__tts.reset());
  await page.evaluate((reply) => {
    window.__agentedTest.setVisual(null);
    window.__agentedTest.simulateReply(reply);
  }, SKETCH_REPLY);

  // Wait until the lesson has actually finished. Waiting on a hard-coded beat
  // count is brittle (the reply re-segments whenever the tutor's wording
  // changes), and waiting on "one utterance ended" returns while later beats are
  // still queued — which silently drops their pairings. Waiting for the log to
  // stop growing handles both.
  await page.waitForFunction(
    () => {
      const log = window.__tts.log;
      const now = performance.now();
      const last = log[log.length - 1];
      // At least two beats, and the most recent one has finished speaking.
      return log.length >= 2 && last && last.end !== null && now - last.end > 900;
    },
    null,
    { timeout: 25000 },
  );
  const pairs = await page.evaluate(() =>
    window.__tts.log.map((e) => ({ beat: e.text, label: e.boardLabel })),
  );

  const labels = [...new Set(pairs.map((p) => p.label))].filter(Boolean);
  check(
    "the board shows more than one picture during the lesson",
    labels.length >= 2,
    labels.join(" | ") || "none",
  );

  // Each pairing is the real assertion: the sketch and the sentence that chose
  // it must be the same beat, not merely both present somewhere in the lesson.
  for (const [noun, labelRe] of [
    ["cat", /cat/i],
    ["email", /email|inbox/i],
  ]) {
    const hit = pairs.find((p) => labelRe.test(p.label) && labelRe.test(p.beat));
    check(
      `the ${noun} picture is up while the owl is saying ${noun}`,
      Boolean(hit),
      hit ? `label="${hit.label}" beat="${hit.beat.slice(0, 46)}"` : `labels=${labels.join("|") || "none"}`,
    );
  }

  // A question beat shows the question mark, not a hazard sign. The closing
  // check here contains the word "wrong", which would otherwise pull up the
  // warning triangle and make the owl look like it is scolding rather than
  // asking. (Asserted directly too in sketch-test.ts.)
  const askPair = pairs.find((p) => /question/i.test(p.label));
  check(
    "the closing question shows the question mark",
    Boolean(askPair),
    `labels=${labels.join(" | ") || "none"}`,
  );
  check(
    "no question beat shows a warning sign",
    !pairs.some((p) => /warning/i.test(p.label)),
    labels.join(" | "),
  );

  // A real sketch must actually be an <svg> on the board, not just a title.
  const svgSeen = await page.evaluate(
    () => !!document.querySelector("#owl-stage .owl-board-art svg"),
  );
  check("the board renders an svg for the sketch", svgSeen);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} beat playback checks passed`);
if (failed > 0) process.exit(1);

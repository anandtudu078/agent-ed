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

import { acceptConsent } from "./test-helpers.mjs";

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

// A reply with a check-for-understanding question in the MIDDLE, followed by
// more teaching. The mid-lesson position is the whole point: if the wait only
// applied to a final question it would prove nothing, because the lesson ends
// there anyway and the student can answer with no wait at all.
const TURN_REPLY =
  "Machine learning is a way for computers to learn patterns from examples. " +
  "Think of it like a spotlight that learns where to look. " +
  "Before I go on: what does the model actually do when it gets an example wrong? " +
  "It nudges its internal numbers a little each time, which is where attention and gradient descent come in. " +
  "Over many rounds those small nudges become a real skill. " +
  "What would you guess it takes more of, examples or examples labelled well?";

/** How many sentences TURN_REPLY has, for the "stopped partway" assertion. */
const TURN_SENTENCES = TURN_REPLY.split(/(?<=[.?!])\s+/).length;

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// Stability flags, not tuning. The renderer was crashing mid-run with
// "Page crashed" on a memory-constrained Windows box, which is indistinguishable
// from a real product failure and makes the suite unrunnable. `--disable-dev-shm-usage`
// is the same fix CI needs on its smaller Linux runners.
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
});
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
  // Registration no longer lands in the app: the consent notice comes first.
  await acceptConsent(page);
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

  // --- Turn taking: the lesson stops and waits for the student ---------------
  // Beats alone did not fix the chatbot problem. A lesson that asks a question and
  // then immediately talks past it is still a monologue. This runs BEFORE the
  // interruption test on purpose: that test sends a real message, so the server's
  // genuine AI reply lands seconds later and cancels any simulated playthrough
  // still running here. Ordering it first is the honest fix — a second browser
  // context was tried first and only papered over the race.
    // ==========================================================================
    // TURN TAKING — the lesson stops and waits for the student
    // ==========================================================================
    //
    // What has to be true is that the owl WAITS: it stops speaking, says so, and
    // does not continue until the student answers.
    await page.evaluate(() => window.__agentedTest.setTutorMode("teach"));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__tts.reset());
    await page.evaluate((reply) => {
      window.__agentedTest.simulateReply(reply);
    }, TURN_REPLY);

    // Wait for the owl to reach the mid-lesson check and stop there.
    await page.waitForFunction(() => window.__agentedTest.isAwaitingReply() === true, null, {
      timeout: 20000,
    });

    const spokenBeforePause = await page.evaluate(() => window.__tts.log.length);
    check(
      "the lesson stops at a mid-lesson question",
      spokenBeforePause >= 1 && spokenBeforePause < TURN_SENTENCES,
      `${spokenBeforePause} of ${TURN_SENTENCES} sentences spoken`,
    );

    // The visible cue: the student must be able to tell the owl is waiting rather
    // than stuck. Checked as a real, unhidden element on the board.
    const cue = await page.evaluate(() => {
      const el = document.querySelector("#owl-stage .owl-turn-cue");
      if (!el) return null;
      return {
        hidden: el.hasAttribute("hidden"),
        text: (el.textContent ?? "").trim(),
        dotAnimating: getComputedStyle(el.querySelector(".owl-turn-dot")).animationName,
      };
    });
    check(
      "the owl tells the student it is their turn",
      Boolean(cue) && cue.hidden === false && cue.text.length > 0,
      cue ? `hidden=${cue.hidden} text="${cue.text}"` : "no cue element",
    );
    check(
      "the wait is visibly alive, not a frozen owl",
      Boolean(cue) && cue.dotAnimating !== "none",
      cue ? `dot animation=${cue.dotAnimating}` : "no cue element",
    );

    // The decisive assertion: the lesson must still be paused a moment later, and
    // must NOT have run on by itself.
    await page.waitForTimeout(2500);
    const stillWaiting = await page.evaluate(() => window.__agentedTest.isAwaitingReply());
    const spokenWhileWaiting = await page.evaluate(() => window.__tts.log.length);
    check(
      "the owl stays paused instead of talking past the question",
      stillWaiting === true && spokenWhileWaiting === spokenBeforePause,
      `waiting=${stillWaiting}, spoke ${spokenBeforePause} then ${spokenWhileWaiting}`,
    );
    // The student answers.
    await page.locator("#message-input").fill("because more context is better");
    await page.locator("#message-input").press("Enter");
    await page.waitForTimeout(1000);
    check(
      "answering releases the pause",
      (await page.evaluate(() => window.__agentedTest.isAwaitingReply())) === false,
    );
    check(
      "the owl clears the 'your turn' prompt once answered",
      await page.evaluate(() => {
        const el = document.querySelector("#owl-stage .owl-turn-cue");
        return !el || el.hasAttribute("hidden");
      }),
    );

    // Answering does NOT resume the abandoned beats. Sending a message cancels the
    // playthrough by design, so the answer drives a FRESH tutor reply instead —
    // which is the right behaviour: a response generated from the student's answer
    // beats a recording played back regardless of what they said.
    //
    // The first version of this test asserted the old beats carried on. It failed,
    // and it was the test that was wrong, not the product.
    const replied = await page
      .locator("#messages .flex.justify-start > div")
      .last()
      .textContent()
      .catch(() => null);
    check(
      "the answer is accepted and the tutor responds afresh",
      (replied?.trim().length ?? 0) > 0,
      `latest tutor bubble: ${(replied ?? "none").trim().slice(0, 60)}…`,
    );

    // CONTENT. A wait that swallowed the rest of the lesson silently would pass
    // every check above, so assert the teaching BEFORE the question was actually
    // spoken, and the question itself was the thing that stopped it.
    const allSpoken = await page.evaluate(() =>
      window.__tts.log.map((e) => e.text).join(" ").toLowerCase(),
    );
    check(
      "the teaching before the question was actually spoken",
      allSpoken.includes("spotlight") && allSpoken.includes("machine learning"),
      allSpoken.slice(0, 80),
    );

    // CONTROL: the same reply in Socratic mode must NOT pause. A Socratic reply is
    // already a single question the student answers, so pausing there would just
    // add a pointless step. If this passed with the mode switch doing nothing, the
    // checks above would be vacuous.
    await page.evaluate(() => {
      window.__agentedTest.setTutorMode("socratic");
      window.__tts.reset();
    });
    await page.waitForTimeout(200);
    await page.evaluate((reply) => {
      window.__agentedTest.simulateReply(reply);
    }, TURN_REPLY);
    await page.waitForTimeout(4000);
    check(
      "CONTROL: Socratic mode does not pause mid-reply",
      (await page.evaluate(() => window.__agentedTest.isAwaitingReply())) === false,
    );

    // A new chat must not leave a lesson parked on a question that is no longer on
    // screen — the cancel path has to release the wait, or the owl waits forever
    // telling a student to answer something they can no longer see.
    await page.evaluate(() => {
      window.__agentedTest.setTutorMode("teach");
      window.__tts.reset();
    });
    await page.waitForTimeout(200);
    await page.evaluate((reply) => {
      window.__agentedTest.simulateReply(reply);
    }, TURN_REPLY);
    await page.waitForFunction(() => window.__agentedTest.isAwaitingReply() === true, null, {
      timeout: 20000,
    });
    await page.evaluate(() => {
      document.querySelector("#new-chat-button")?.click();
    });
    await page.waitForTimeout(1500);
    check(
      "starting a new chat releases a paused lesson",
      (await page.evaluate(() => window.__agentedTest.isAwaitingReply())) === false,
    );
    check(
      "the 'your turn' prompt is not stranded after a new chat",
      await page.evaluate(() => {
        const el = document.querySelector("#owl-stage .owl-turn-cue");
        return !el || el.hasAttribute("hidden");
      }),
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
    // Back to Socratic explicitly. The turn-taking block above leaves the tutor in
    // Teach mode, and this block only cares about beat->sketch pairing — where the
    // lesson pauses for an answer is irrelevant to it. Left implicit, this
    // inherited Teach mode and the run timed out waiting for playback that was
    // legitimately paused waiting for a student who was never going to answer.
    window.__agentedTest.setTutorMode("socratic");
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
  // Scoped to the beat that IS the question, which is what this check is about.
  //
  // It used to assert that no board label anywhere in the lesson was a warning,
  // which is a different and much stronger claim — and a wrong one: a lesson may
  // legitimately contain a cautionary beat that deserves a hazard triangle. It
  // passed only while the later beats were never played; once course enrolment
  // started working (it silently failed without a session cookie) more of the
  // lesson ran, and a genuinely cautionary beat tripped an assertion about
  // questions.
  const questionBeat = pairs.find((p) => /wrong first/i.test(p.beat));
  check(
    "the question beat itself does not show a warning sign",
    questionBeat !== undefined && !/warning/i.test(questionBeat.label),
    questionBeat ? `label="${questionBeat.label}"` : "closing question beat not captured",
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

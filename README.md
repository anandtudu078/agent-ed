# AgentEd — an adaptive AI tutor for artificial intelligence

A character-led tutor that teaches AI/ML to students, remembers what each one
actually gets wrong, and changes how it teaches them because of it.

```
diagnose → teach → test → adapt → schedule review → welcome back
```

The point of this project is the **last four steps**. Most tutoring software
generates explanations. This one keeps a model of the individual student —
their weak concepts, their specific wrong ideas, what is holding them up, and how
they are behaving right now — and feeds that into the prompt that writes the
next reply.

---

## Quick start

**Prerequisites**

- Node.js **24 or newer** — required, not preferred. The client test suites run as
  `node scripts/*.ts` and rely on native type stripping; on Node 20 or 22 they
  die with `ERR_UNKNOWN_FILE_EXTENSION` before a single check runs. Both
  `package.json` files declare `"engines": { "node": ">=24" }` so npm warns you
  rather than letting you discover it as a mysterious test failure.
- A MongoDB instance — local `mongod`, a container, or a free MongoDB Atlas cluster
- A free [Groq](https://console.groq.com) API key for the AI features

**1. Install**

```bash
npm ci
npm ci --prefix client
```

Use `ci` rather than `install` — it installs exactly what `package-lock.json`
pins, so you get the same tree every time instead of npm quietly resolving
something newer. Verified from an empty `node_modules`.

**2. Configure**

```bash
cp .env.example .env
```

Then edit `.env`. Three values matter:

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | **yes** | `mongodb://127.0.0.1:27017/agented` works with local Mongo |
| `JWT_SECRET` | **yes** | At least 16 characters. The server refuses to start without it. |
| `GROQ_API_KEY` | **yes** | Everything AI — tutor, assessments, diagrams. Without it the app runs but cannot answer. |
| `GEMINI_API_KEY` | no | Tried first; Groq is the fallback when Gemini's quota is spent |
| `GEMINI_EXTRA_KEYS` | no | Comma-separated extra Gemini keys, rotated when the primary is exhausted |
| `CLIENT_ORIGIN` | no | Already defaults to the dev client at `localhost:5173` |
| `AI_DAILY_CALL_LIMIT` | no | Per-student daily AI budget. Defaults to 250 |
| `PORT` | no | Defaults to 3000 |

`.env` is loaded automatically by `dotenv` — no extra flags needed.

**3. Run the server and the client in two terminals**

```bash
npm run dev                  # API on http://localhost:3000
npm run dev --prefix client   # app on http://localhost:5173
```

Open **http://localhost:5173** and create an account.

The catalog seeds itself on first dashboard load — no migration step.

**No AI key?** Registration, sign-in, the course catalog and the dashboard all
work. Only the tutor, assessments and diagrams need one.

---

## Tests

560 checks across fourteen suites. Start here.

```bash
npm test              # runs every suite that needs no browser (10 suites, ~40s)
```

Or individually:

| Command | Checks | What it covers |
|---|---|---|
| `npm run test:parse` | 36 | `parseVisualSpec` — rejects hostile model output |
| `npm run test:review` | 38 | Spaced-repetition scheduling |
| `npm run test:profile` | 30 | The learner profile and its prompt rendering |
| `npm run test:difficulty` | 20 | Adaptive difficulty bands |
| `npm run test:prereqs` | 17 | The prerequisite graph |
| `npm run test:flow` | 18 | Flow signals |
| `npm run test:return` | 32 | Return detection and first run |
| `npm run test:offline` | 98 | The offline AI gate, the auth cookie policy, and the consent rules |
| `npm run test:quality` | 50 + judged | Whether the tutor actually teaches — **needs a live AI key** |
| `npm run test:beats` | 24 | Lesson-beat segmentation |
| `npm run test:sketches` | 50 | Beat-sketch matching and SVG rendering |
| `npm run test:render` | 29 | Diagram renderers (from `client/`) |
| `npm run test:ui` | 102 | Full browser flows, consent step, no readable tokens (Playwright) |
| `npm run test:playback` | 31 | Beat sequencing, turn-taking and sketch/board pairing (Playwright) |
| `npm run test:security` | 53 | Auth, authz, CORS, CSRF, cookies, consent enforcement, XSS |

The three browser suites need the app running (`npm run dev` in both terminals)
and a reachable MongoDB:

```bash
npm run test:security   # first: it can burn the auth rate-limit budget
npm run test:ui
npm run test:playback
```

`test:security` is listed first on purpose. It can optionally exhaust the auth
rate limiter, which would then block the registration the UI suite depends on.

Type-check both projects:

```bash
npx tsc --noEmit              # server
npx tsc --noEmit --project client/tsconfig.json
```

> The `parse` and `render` suites are the security boundary for everything the
> owl draws. They had no permanent coverage before — the earlier tests were a
> throwaway script that was later deleted.

### Does the tutor actually teach?

Every other suite tests the app *around* the model - parsing, scheduling,
segmentation, rendering, authorisation. `test:quality` asks the question none of
them ask: is the teaching any good?

```bash
npm run test:quality     # needs GROQ_API_KEY or GEMINI_API_KEY
```

It calls the real `generateTutorResponse` with the real system prompts across
eight cases - Socratic and Teach, English and Hindi, including a follow-up that
has thread context and a student who demands the answer outright - and grades
what comes back in two separate layers:

**Contract checks (50) - deterministic, and they gate.** The promises the
prompts make and the code depends on: Socratic mode must not hand over the
answer, must ask something, must stay short enough to think about; Teach mode
must explain substantively and close by checking understanding; Hindi must come
back as Devanagari. A prompt is a request. These make some of them obligations.

**Judged checks - one model call per case, reported but never gating.** Factual
soundness, whether the withholding actually worked, whether it built on the
thread, whether a beginner would understand it. These are a grader that is
itself a language model, so failing a run on its opinion would produce a flaky
suite nobody trusts. The scores are a baseline to watch for drift.

Dimensions are only scored where they apply. `withholds` is not counted on a
Teach-mode case, where explaining *is* the job, and `buildsOnThread` is not
counted when the case has no prior turn. A baseline that punishes correct
behaviour is worse than no baseline.

Last run:

```
CONTRACT   50/50 passed
JUDGED     withholds        5/5  (100%)
           factuallySound   8/8  (100%)
           onTopic          6/8  ( 75%)
           helpsABeginner   7/8  ( 88%)
           buildsOnThread   1/1  (100%)
```

Not in CI: it spends real provider quota and takes a few minutes. It is a manual
gate before a release, not on every push. `QUALITY_SHOW_REPLIES=1` prints every
reply for reading.

> The honest limit: this measures whether the tutor *behaves* as specified. It
> cannot prove the explanations are pedagogically good, and the judge shares a
> blind spot with the model it is grading. It is a floor, not a ceiling.
### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `master`, in
two jobs:

- **Types and unit tests** — both `tsc` projects plus the ten no-browser suites.
  No services and no API keys, so a regression fails in under a minute.
- **Browser suites** — a MongoDB service container, the built API on `:3000`,
  Vite on `:5173`, and Playwright Chromium. Runs security, then UI, then
  beat playback, and uploads failure screenshots as an artifact.

The split is not a convenience. All four bugs fixed in the beat-and-sketch work
passed review and passed every unit suite, and failed only in a browser — a
sticky mood left behind by beat playback, a language switch that appeared to do
nothing, a reaction talked over by a stale explanation. None were reachable from
a pure logic test, which is the reason the slow job exists at all.

CI uses no AI provider keys. The browser suites are made possible by a
deterministic stand-in for the assessment endpoints
(`src/services/offlineAi.ts`), which answers on the **server** rather than in the
browser — so the whole pipeline runs for real: question → grade → `Progress` and
`Session` writes → dashboard render. A browser-side stub would have painted a
result panel while writing none of that, forcing the review-card and weak-point
checks to be skipped.

The stand-in is gated behind `ALLOW_OFFLINE_AI=1` and **refuses outright when
`NODE_ENV=production`**. That guard is the entire safety story: a deploy with a
missing key would otherwise show real students a fabricated score and invented
feedback, which is strictly worse than the honest `502` the routes return today.
`npm run test:offline` exists mostly to attack that guard.

Its score is deliberately set below `REVIEW_PASS_SCORE`, so an offline run still
records a weak point and a due review card. A higher score would take the happy
path through a pipeline that would otherwise never execute in CI.

### The owl takes turns

Beats made the tutor's delivery readable. They did not make it a *lesson*: a
lesson that asks a question and then talks straight past it is still a monologue,
and a monologue is the defining shape of a chatbot — user asks, system emits a
block of prose, user watches.

So in **Teach mode** the playback loop now stops at each check-for-understanding
beat and waits. The owl goes expectant, the status pill returns to `Idle` (it is
not thinking or teaching, it is waiting), and a pulsing cue appears under the
bubble: *"Your turn — answer to continue"*, in Hindi as well. The lesson
continues only after the student replies. In **Socratic mode** nothing pauses,
because a Socratic reply is already a single question the student answers.

Three things can end a wait: an answer, an interruption, or four minutes. The
timeout is not optional — a student who closes the tab must not leave a pending
promise, and one who does not know what to say should get the rest of the
explanation rather than a frozen owl.

Answering *cancels* the remaining beats rather than resuming them, so the answer
drives a fresh tutor reply. A response generated from what the student actually
said beats a recording played back regardless — but it does mean the beats after
a mid-lesson question are never heard. That trade is documented under
[Known limits](#known-limits) rather than left to be discovered.

This also fixed a real bug: **New Chat did not stop the owl.** Bumping
`conversationEpoch` invalidates incoming replies, but a beat playthrough is
driven entirely on the client, so clearing the thread under a running lesson left
it talking — or, once turn-taking landed, waiting for an answer to a question
that had just been deleted from the screen.

---

## How the adaptive loop works

**A student asks about transformers.** The tutor receives the transcript, the
topic, their language, and a briefing built from what we know:

> *What you already know about this student:*
> *- Shaky so far: backpropagation*
> *- Solid on: matrix multiplication. Do not re-explain from scratch.*
> *- They have repeatedly shown this wrong thinking: thinks backprop is the same
> as gradient descent*
> *- They are struggling across several topics. Slow down, use a concrete
> example before any formula.*

**They get tested.** The question's difficulty comes from their strength *and*
review history, so a struggling student gets a single concrete step rather than
a two-part abstraction.

**They answer.** Three things are stored: the score, the *specific wrong idea*
the answer revealed, and when. Strength blends with what was already known
rather than replacing it. A review is scheduled — further out if it landed,
tomorrow if it didn't.

**They come back tomorrow.** The dashboard says *"Start with matrix
multiplication"*, not *"work on transformers"*, because the graph says
transformers sits on top of it.

**They ask the same thing a fourth time.** Within 45 minutes, substantively the
same question, the tutor is told to change approach — and explicitly *not* to
mention the repetition.

---

## Architecture

```
src/
  server.ts                    API + socket
  data/curriculum.ts           186 modules, 9 AI branches + maths spine
  services/
    aiService.ts               tutor prompt; takes the learner briefing
    progressService.ts         learner profile, difficulty, prerequisites
    flowSignals.ts             repetition and pacing
    returnState.ts             "welcome back"
    visualService.ts           validates model output into a diagram spec
  models/                      User, Session, Progress, Course, tokens, usage
  middleware/                  auth, rate limits, AI spend cap

client/src/
  main.ts                      chat, speech, return path, first run
  components/mascot.ts         the owl - six moods, real reactions
  components/diagrams.ts       hand-written SVG, every string escaped
  components/dashboard.ts      reviews, weak points, root cause

scripts/                       the test suites
```

**The seam worth reading first** is `generateTutorResponse` in
`src/services/aiService.ts`. Its `learnerBriefing` parameter is what turns this
from a textbook with a dashboard into a tutor — before it existed, none of the
collected telemetry reached the model at all.

---

## Session handling

Tokens are **httpOnly cookies**, not `localStorage`. A token in `localStorage` is
readable by any script on the page, so one injected `<script>` exfiltrates a
student's session with no user interaction and nothing visible to notice. An
httpOnly cookie cannot be read by JavaScript at all.

Moving the credential into a cookie is only half the change — cookies are
attached to cross-site requests automatically, which is the problem `localStorage`
never had. Two defences, deliberately redundant:

- **`SameSite=Lax`** on both cookies. Blocks the cross-site POST that CSRF
  actually needs. `strict` would be stronger and would also break a student
  arriving from a shared lesson link, so `lax` is the trade.
- **An `X-Requested-With` check** on every non-GET API request
  (`requireCsrfHeader`). A cross-origin caller cannot set a custom header without
  a CORS preflight, and this server refuses preflights from unlisted origins.

`Secure` is set in production and deliberately **not** in development: a `Secure`
cookie over `http://localhost` silently vanishes, and the only symptom is "login
is broken". `npm run test:offline` asserts both directions, including that
`NODE_ENV=Production` (capitalised, as some hosts set it) still marks cookies
secure — the same case-sensitivity trap that once left the offline AI gate open in
production.

Two things the migration could not keep, and did not try to:

- **`GET /api/auth/me`** now exists, because "am I signed in?" can no longer be
  answered from local storage — a cached display name is not a session. The boot
  path paints from the cache and confirms against the API, so an expired session
  lands on the auth screen instead of a shell full of 401s.
- **Sign-out awaits the server** before showing the auth screen. Fire-and-forget
  looked fine while the token lived in local storage, where removing it was
  synchronous; with a cookie, the UI could claim to be signed out while the
  credential was still live and a reload would sign the student straight back in.

---

## Consent, and who it protects

This app is aimed at students — the people least able to consent meaningfully to
their data going to a third party. Every tutor prompt carries a student's own
words, their mistakes and their progress, out to Groq or Gemini. So the flow is
built around one decision, and everything else serves it:

> **May this student send a question to an AI provider?**

**Where the rule lives.** `src/services/consent.ts`, as pure functions. Not in a
route, not in the form. A rule like "a minor without guardian consent must be
refused" is worth far more with 60 unit tests than a paragraph in a README — and
consent logic has a habit of being duplicated in the form, the API and the client,
where they drift and the copy that matters is the one nobody tests.

**What counts as consent.** Recorded per account: who agreed, which version of the
notice, and when. Deliberately conservative:

- Silence is never consent. A new account cannot use the AI features.
- **Stale consent is not consent.** Bump `CONSENT_POLICY_VERSION` and every
  existing consent goes back to being asked for. That is the entire reason the
  version is stored.
- **Under 18 always needs an adult**, whatever the student ticks. The guardian's
  name is recorded — a blank or one-character name is refused, and a whitespace-only
  name is refused too, since `"   "` is truthy and a naive `if (by)` accepts it.
- A database error is never read as "your account is gone". `requireAuth` fails
  the *request* and keeps the session.

**Enforced on the server, on the only path that reaches a provider.** The socket
chat handler and both assessment routes. Client-side gating is not a control — the
client is the thing an attacker controls — so the server re-reads the record on
every AI call rather than trusting the token, which is good for 30 minutes.

**Withdrawal bites immediately**, for the same reason. A consent that takes half
an hour to revoke is not withdrawal.

**What a refusal does *not* do.** Sign-in, the course catalog, the dashboard, and
exporting your own data all work without consent. Only calls that leave the
machine are gated. Refusing a minor their own account would be a worse outcome
than not teaching them.

**Data rights, because a notice that promises them is worth nothing:**

- `GET /api/account/export` — everything held, as JSON. Works whether or not
  consent was given; the right to see your data cannot depend on agreeing to
  anything. The password hash is included on purpose: it is one-way, and omitting
  it from your own export looks like concealment.
- `DELETE /api/account` — erases the account, conversation, progress and tokens.
  Scoped by the authenticated id, never a username from the request body.
- `DELETE /api/auth/consent` — withdraws consent and keeps the progress, so
  changing your mind about the notice is not punished by losing your work.

**One bug this found, which is why it is worth reading.** Erasure did not revoke
the session: `requireAuth` trusted the JWT, which stays valid for 30 minutes, so a
deleted account kept working until it expired. It now confirms the account still
exists on every authenticated request — one indexed `_id` read, which is the price
of deletion actually working.

The trade, stated plainly: **the guardian's name is self-reported**, because
verifying it would mean emailing an adult and there is no mail infrastructure
here. That is how school-registered accounts are usually set up, but it is not
verification, and the app should not pretend otherwise.
A bearer header is still accepted as a fallback, which is what lets the security
suite and any scripted client authenticate without a cookie jar. The browser path
never uses it.

---

These are judgement calls about a person, not facts about a model. They are the
most likely things to need changing.

- **Remedial work is never labelled.** Nothing tells the student the difficulty
  changed, and the prompt forbids mentioning it. A student handed easier work
  should believe it was a normal question.
- **Repetition is never pointed out.** The tutor is told to change approach, not
  to say *"you've asked this three times"*.
- **No emotion detection.** Frustration isn't observable from message text. A
  test asserts the guidance never names a feeling.
- **Silence is not "you're doing great".** A student with no data gets no
  briefing at all, rather than an empty one that reads as an absence of gaps.
- **"Struggling" needs two data points.** One bad test is a bad test.
- **The prerequisite graph is sparse on purpose.** A wrong edge sends a student
  backwards for no reason; an uncurated edge is cheaper than a wrong one.
- **Everything time-dependent is derived on read.** A stored `isDue` flag goes
  stale the instant midnight passes.

---

## Security notes

- Model output is never trusted. `parseVisualSpec` bounds and type-checks every
  field and returns `null` on any problem; the renderers escape all text and
  emit only hand-written SVG. Raw SVG from a model is never rendered — that
  would be an XSS hole.
- Rate limits are keyed on the signed-in **user**, not IP, because a school
  puts a whole classroom behind one address.
- Refresh tokens rotate on use and are stored only as a SHA-256 hash. Replaying
  a spent token revokes the whole family.
- A daily AI spend cap per student, which fails open so a database blip can't
  take the app down.

---

## Known limits

- **The tutor can still recite.** The prompt asks it to name misconceptions
  directly; nothing enforces it. Verified the reply *changes*, not that it
  always says the right thing.
- **No true lip-sync.** The beak flaps on a timer — `SpeechSynthesis` gives no
  reliable boundary events. Word-accurate would mean abandoning it for
  prerecorded audio, which would cost Hindi support. What the owl does instead is
  *segment* a reply into short beats (`client/src/components/beats.ts`) and play
  them in sequence with a gap between each, so the delivery has rhythm even
  though the mouth shapes do not match the phonemes.
- **Beat segmentation is prose, not structure.** Beats are cut on sentence and
  clause boundaries with a word cap, so a reply the tutor wrote as a numbered
  list is split sensibly only because the lines happen to break. A single
  40-word sentence with no clause punctuation is broken at the least-bad comma,
  and no beat is ever re-ordered to match the diagram.
- **A wait is not the same as a reply.** In Teach mode the lesson stops at each
  check-for-understanding beat and waits up to four minutes for an answer. But
  answering *cancels* the rest of that lesson rather than resuming it — the
  answer drives a fresh tutor reply instead, which is usually what you want but
  does mean the beats after a mid-lesson question are never heard. Making the
  wait conditional on what the student actually said needs the tutor to be
  re-entered mid-lesson, which it is not.
- **Beat sketches are a keyword table, not a picture model.** Sixteen hand-drawn
  SVGs are picked by matching nouns in the beat (`client/src/components/sketches.ts`).
  A beat naming two concrete things gets whichever the cue table lists first, so
  "teach a child to recognise a cat" shows the cat — the thing being
  recognised — rather than the child. A beat naming nothing concrete gets no
  picture at all, and the board falls back to the topic diagram.
- **Memory is 12 messages.** Enough for a thread, thin for a session.
- **Prerequisite coverage is 70 of 186 modules.** Maths and deep learning are
  solid; NLP, vision, speech and robotics are largely uncurated.
- **No teacher view.** Needed before real deployment in a school. The consent
  flow is done; a teacher cannot yet see a cohort's progress.
- Gemini's free tier is exhausted on the development account, so Groq has been
  carrying everything. Both paths work; only the fallback has been exercised
  recently.


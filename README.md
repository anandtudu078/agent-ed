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

- Node.js 20+ (developed on 24)
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

430 checks across thirteen suites. Start here.

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
| `npm run test:beats` | 24 | Lesson-beat segmentation |
| `npm run test:sketches` | 50 | Beat-sketch matching and SVG rendering |
| `npm run test:render` | 29 | Diagram renderers (from `client/`) |
| `npm run test:ui` | 93 | Full browser flows (Playwright) |
| `npm run test:playback` | 20 | Beat sequencing and sketch/board pairing (Playwright) |
| `npm run test:security` | 23 | Auth, authz, CORS, token rotation, XSS |

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

CI uses no AI provider keys. The UI suite is written to tolerate a tutor reply
failing, so a green run does not depend on a third party being up.

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

## Design decisions worth arguing with

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
- **Beat sketches are a keyword table, not a picture model.** Sixteen hand-drawn
  SVGs are picked by matching nouns in the beat (`client/src/components/sketches.ts`).
  A beat naming two concrete things gets whichever the cue table lists first, so
  "teach a child to recognise a cat" shows the cat — the thing being
  recognised — rather than the child. A beat naming nothing concrete gets no
  picture at all, and the board falls back to the topic diagram.
- **Memory is 12 messages.** Enough for a thread, thin for a session.
- **Prerequisite coverage is 70 of 186 modules.** Maths and deep learning are
  solid; NLP, vision, speech and robotics are largely uncurated.
- **Tokens live in `localStorage`,** so they are exposed to XSS. httpOnly
  cookies is the right fix and is not done here.
- **No teacher view, and no consent flow.** Both are needed before real
  deployment with minors.
- Gemini's free tier is exhausted on the development account, so Groq has been
  carrying everything. Both paths work; only the fallback has been exercised
  recently.


import "dotenv/config";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { connectDB } from "./config/db";
import {
  ConversationMessage,
  MAX_STORED_TOPIC_VISITS,
  Session,
  TopicVisit,
} from "./models/Session";
import {
  analyzeStudentInput,
  generateTutorResponse,
  type TutorMode,
  type TeachLanguage,
} from "./services/aiService";
import { recordLearningSignal } from "./services/progressService";
import { refreshEnrollments } from "./services/courseService";
import { generateVisual, type VisualSpec } from "./services/visualService";
import authRouter from "./routes/auth";
import accountRouter from "./routes/account";
import assessmentRouter from "./routes/assessment";
import coursesRouter from "./routes/courses";
import dashboardRouter, { seedCatalogOnce } from "./routes/dashboard";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
  requireCsrfHeader,
  verifyAuthToken,
  ACCESS_COOKIE,
} from "./middleware/auth";
import {
  chatRateLimit,
  createSocketLimiter,
} from "./middleware/rateLimit";
import { aiSpendLimit, consumeDailyAiCall, pruneOldUsage } from "./middleware/aiSpendLimit";
import { Progress } from "./models/Progress";
import { User } from "./models/User";
import { assertConsent, requireConsent } from "./middleware/consent";
import { CONSENT_REQUIRED_MESSAGE } from "./services/consent";
import {
  buildLearnerProfile,
  difficultyForTopic,
  renderLearnerBriefing,
} from "./services/progressService";
import { flowGuidance, flowSignals } from "./services/flowSignals";
import {
  awayLabel,
  isFirstRun,
  recommendedStarterCourse,
  returnState,
} from "./services/returnState";

const app = express();
const httpServer = createServer(app);

/**
 * CORS allowlist: the Vercel frontend plus localhost for development. An
 * unset CLIENT_ORIGIN would previously have left the API readable from any
 * origin; now the allowlist is derived explicitly instead.
 */
const allowedOrigins = [
  "https://agent-ed-sage.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim()) : []),
];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : undefined,
    // The session now lives in a cookie, so the socket handshake must be allowed
    // to carry it. Without this the browser withholds the cookie and every socket
    // connection is rejected as unauthenticated — with an error that looks like a
    // CORS problem rather than a credential one.
    credentials: true,
  },
});

const port = Number(process.env.PORT ?? 3000);

/**
 * The app runs behind Render's reverse proxy in production, so without this
 * Express would take the proxy's IP for every request and the IP-based rate
 * limits would throttle everyone collectively (or be bypassable). Trust
 * exactly one proxy hop — never "true", which would let clients spoof
 * X-Forwarded-For directly against us.
 */
app.set("trust proxy", 1);

/**
 * Retention caps. `conversationHistory` lives inside a single document, and
 * MongoDB rejects anything over 16 MB — without a cap, a long-running student
 * silently loses the ability to chat at all once the array gets too big.
 * The prompt only ever uses the most recent `MAX_PROMPT_HISTORY_MESSAGES`
 * (see aiService), so trimming the tail costs the tutor nothing.
 */
const MAX_STORED_MESSAGES = 200; // ~100 exchange pairs
// MAX_STORED_TOPIC_VISITS now lives in models/Session.ts: the assessment route
// appends to topicsVisited too, and a cap only the chat path applied is not one.

// Security headers (CSP defaults, nosniff, frameguard, HSTS…).
app.use(helmet());

app.use(
  cors({
    // Required for cookies to be accepted cross-origin. The client is served from
    // a different port (5173 in dev, a Vercel URL in production), so without this
    // the browser drops every `Set-Cookie` and the app silently loses the ability
    // to sign anyone in.
    credentials: true,
    origin(origin, callback) {
      // Allow non-browser tools (curl, same-origin, server-to-server) with no Origin.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  }),
);
// Required for `requireAuth` to read the session cookie off the request.
app.use(cookieParser());
app.use(express.json());

// Second lock against CSRF, alongside `SameSite=Lax` on the cookie itself. Applied
// after CORS so a rejected origin is already answered before this runs.
app.use("/api", requireCsrfHeader);

app.use("/api/auth", authRouter);
app.use("/api/account", accountRouter);
app.use("/api/assessment", assessmentRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/dashboard", dashboardRouter);

interface StudentMessagePayload {
  studentId: string;
  activeTopic: string;
  studentMessage: string;
  /** Defaults to "socratic" when absent, so older clients keep working. */
  mode?: TutorMode;
}

interface ChatResult {
  response: string;
  analysis: string;
  mode: TutorMode;
  /** Diagram for the lesson board, or null when none fits. */
  visual: VisualSpec | null;
  session: {
    studentId: string;
    activeTopic: string;
    conversationHistory: unknown[];
  };
}

/** Normalize an untrusted mode value; anything unrecognized falls back. */
function parseMode(value: unknown): TutorMode {
  return value === "teach" ? "teach" : "socratic";
}

function validateStudentMessage(
  payload: unknown,
): asserts payload is StudentMessagePayload {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as Record<string, unknown>).studentId !== "string" ||
    typeof (payload as Record<string, unknown>).activeTopic !== "string" ||
    typeof (payload as Record<string, unknown>).studentMessage !== "string"
  ) {
    throw new Error(
      "studentId, activeTopic, and studentMessage are required strings.",
    );
  }

  const message = payload as StudentMessagePayload;
  if (
    !message.studentId.trim() ||
    !message.activeTopic.trim() ||
    !message.studentMessage.trim()
  ) {
    throw new Error(
      "studentId, activeTopic, and studentMessage cannot be empty.",
    );
  }
}

// Messages safe to show to clients; anything else (provider dumps, stack
// traces, internal details) is logged but replaced with a generic message.
const CLIENT_SAFE_ERROR_PATTERNS = [
  "required strings",
  "cannot be empty",
  "All Gemini models are unavailable",
  "Unable to save the tutoring session.",
  // The consent refusal is the one deliberate exception: hiding it behind a
  // generic "temporarily unavailable" would tell a student to retry when retrying
  // can never work, and would leave the client unable to show them the notice.
  CONSENT_REQUIRED_MESSAGE,
  "Please choose an age group.",
  "The privacy notice has to be accepted to continue.",
  "parent or guardian",
  "That name is too long.",
];

function toClientMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unable to process chat request.";
  return CLIENT_SAFE_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
    ? message
    : "The AI tutor is temporarily unavailable. Please try again in a moment.";
}

/**
 * Throw unless this user has valid consent to use the AI features.
 *
 * The socket chat path calls this directly (it is not a route); the assessment
 * routes use the `requireConsent` middleware. Both delegate to the same rule in
 * `services/consent.ts`, so there is exactly one implementation of "is this
 * student allowed to talk to a model".
 */
async function processStudentMessage(
  payload: StudentMessagePayload,
  authUser: AuthUser,
): Promise<ChatResult> {
  validateStudentMessage(payload);

  // Consent gate, before anything is read or sent.
  //
  // This is the enforcement point that matters: it runs before the thread is read
  // and long before the prompt is built, so a student without valid consent cannot
  // cause their own words to leave the server. Client-side gating is not enough —
  // the client is the thing an attacker controls — so the rule lives here, on the
  // only path that reaches a provider.
  await assertConsent(authUser.id);

  // Sessions are keyed by the authenticated username, so one student can
  // never read or write another student's conversation.
  const studentId = authUser.username;
  const studentMessage = payload.studentMessage.trim();

  // Read the thread *before* generating, so the model can see what has already
  // been said. Writing first would mean answering our own new message.
  const prior = await Session.findOne({ studentId })
    .select({ conversationHistory: 1, topicsVisited: 1, activeTopic: 1 })
    .lean();

  const priorMessages: ConversationMessage[] = prior?.conversationHistory ?? [];
  const mode = parseMode(payload.mode);
  // Language comes from the token, not the request body: the client must not be
  // able to set it per-message and desync from the stored preference.
  const language: TeachLanguage = authUser.language === "hi" ? "hi" : "en";

  // What we know about this student, folded into the prompt.
  //
  // The Progress read is separate from the Session read above and is scoped to
  // the caller's own id, so a student can only ever be briefed on themselves.
  // Best effort: losing the briefing degrades the reply to the old
  // one-size-fits-all behaviour, which must never cost the student their
  // answer.
  let learnerBriefing = "";
  try {
    const progress = await Progress.findOne({ studentId })
      .select({ weakPoints: 1, testHistory: 1, reviewCards: 1 })
      .lean();
    // The client's current topic, not the model's: analysis.topic is derived
    // further down, after the tutor has already been called.
    const band = difficultyForTopic(progress, payload.activeTopic);
    learnerBriefing = renderLearnerBriefing(buildLearnerProfile(progress), band);
  } catch (error) {
    console.error("Failed to build the learner profile.", error);
  }

  // Is this student going in circles *right now*? A different question from the
  // learner briefing above, which is built from stored progress: this one reads
  // the shape of the last few messages. Both are pure functions over data we
  // already hold, so a failure here costs nothing and must not cost the reply.
  let guidance = "";
  try {
    guidance = flowGuidance(flowSignals(priorMessages, studentMessage));
  } catch (error) {
    console.error("Failed to derive flow guidance.", error);
  }

  const analysis = await analyzeStudentInput(studentMessage, priorMessages);
  const response = await generateTutorResponse(
    analysis,
    studentMessage,
    priorMessages,
    mode,
    language,
    learnerBriefing,
    guidance,
  );

  // The model names the topic far better than the client's first 60 characters
  // of the message, so its reading wins when we have one.
  const activeTopic =
    analysis.topic || payload.activeTopic.trim() || "General";

  // Record a topic the moment it's first reached; learning speed is measured
  // from how long the student has been covering concepts.
  const newTopicVisits: TopicVisit[] =
    (prior?.topicsVisited ?? []).some(
      (visit) => visit.topic.toLowerCase() === activeTopic.toLowerCase(),
    )
      ? []
      : [{ topic: activeTopic, firstSeenAt: new Date() }];

  // Teach mode is where a diagram earns its place: the owl is explaining a
  // concept, not posing a question. Socratic replies get the question board.
  // Generated *before* the session write so the spec can be stored with the
  // message it belongs to. Best-effort — a missing diagram must never cost the
  // student their answer.
  const visual =
    mode === "teach" ? await generateVisual(activeTopic, response, language) : null;

  const session = await Session.findOneAndUpdate(
    { studentId },
    {
      $set: { activeTopic },
      $push: {
        conversationHistory: {
          $each: [
            { role: "user", content: studentMessage, at: new Date() },
            // The diagram is stored with the message it belongs to, so the
            // board survives a reload. The student otherwise loses the one
            // part of the explanation that can't be read back out of the text.
            { role: "assistant", content: response, visual: visual ?? null, at: new Date() },
          ],
          // Hard cap: a session document can only grow to MongoDB's 16 MB, and
          // an uncapped array eventually fails every write for this student.
          $slice: -MAX_STORED_MESSAGES,
        },
        topicsVisited: {
          $each: newTopicVisits,
          $slice: -MAX_STORED_TOPIC_VISITS,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  if (!session) {
    throw new Error("Unable to save the tutoring session.");
  }

  // Feed the dashboard. Best-effort: a progress write must never fail a reply
  // the student is already waiting on.
  try {
    await recordLearningSignal(
      studentId,
      activeTopic,
      analysis.masteryEstimate,
      session.topicsVisited ?? [],
    );
  } catch (error) {
    console.error("Failed to record learning signal.", error);
  }

  // A new topic may have completed a module in one of the student's courses.
  // Same best-effort rule: course progress must not block the reply.
  try {
    await refreshEnrollments(studentId);
  } catch (error) {
    console.error("Failed to refresh course enrollments.", error);
  }

  return {
    response,
    analysis: JSON.stringify(analysis),
    mode,
    visual,
    session: {
      studentId: session.studentId,
      activeTopic: session.activeTopic,
      conversationHistory: session.conversationHistory,
    },
  };
}

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "AgentEd" });
});

app.get("/api/sessions/:studentId", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser;
    const studentId = String(request.params.studentId ?? "").trim();
    if (!studentId) {
      response.status(400).json({ error: "studentId is required." });
      return;
    }
    // Students may only read their own session.
    if (authUser && authUser.username !== studentId) {
      response.status(403).json({ error: "You can only view your own session." });
      return;
    }
    const session = await Session.findOne({ studentId }).lean();
    if (!session) {
      response.status(404).json({ error: "Session not found." });
      return;
    }

    // Whether the student is coming back or starting fresh. The client has no
    // way to work this out on its own — the conversation, the review cards and
    // the test history all live server-side — and it is the difference between
    // a welcome back and a blank screen.
    const progress = await Progress.findOne({ studentId })
      .select({ reviewCards: 1, testHistory: 1 })
      .lean();
    const returning = returnState({
      conversation: session.conversationHistory,
      reviewCards: progress?.reviewCards ?? [],
      testHistory: progress?.testHistory ?? [],
      activeTopic: session.activeTopic,
    });

    response.json({
      studentId: session.studentId,
      activeTopic: session.activeTopic,
      conversationHistory: session.conversationHistory,
      returning: {
        isFirstRun: isFirstRun({
          conversation: session.conversationHistory,
          testHistory: progress?.testHistory ?? [],
          reviewCards: progress?.reviewCards ?? [],
        }),
        isReturn: returning.isReturn,
        dueCount: returning.dueCount,
        resumeTopic: returning.resumeTopic,
        leftMidQuestion: returning.leftMidQuestion,
        greeting: returning.greeting,
        // The dashboard's "how long were you away" line. Computed here rather
        // than in the client, which has no conversation timestamps to work from.
        awayLabel: awayLabel(returning.awayMs),
      },
      starterCourse: recommendedStarterCourse(),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  } catch (error) {
    console.error("Failed to load session.", error);
    response.status(500).json({ error: "Unable to load session." });
  }
});

/**
 * DELETE /api/sessions/:studentId
 *
 * Clears the conversation. Without this, restoring history is a one-way door:
 * a student would be stuck replaying the same thread forever, with no way to
 * start a clean one. Own conversation only.
 */
app.delete("/api/sessions/:studentId", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser;
    const studentId = String(request.params.studentId ?? "").trim();
    if (!studentId) {
      response.status(400).json({ error: "studentId is required." });
      return;
    }
    if (!authUser || authUser.username !== studentId) {
      response.status(403).json({ error: "You can only clear your own session." });
      return;
    }

    // Keep topicsVisited: those are the student's learning record, not chat
    // history. Clearing them would reset learning speed and course progress.
    const result = await Session.updateOne(
      { studentId },
      { $set: { conversationHistory: [] } },
    );

    response.json({ cleared: result.modifiedCount > 0 });
  } catch (error) {
    console.error("Failed to clear session.", error);
    response.status(500).json({ error: "Unable to clear the conversation." });
  }
});

app.post(
  "/api/chat",
  requireAuth,
  requireConsent,
  chatRateLimit,
  aiSpendLimit,
  async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser;
    const result = await processStudentMessage(
      request.body,
      authUser as AuthUser,
    );
    response.status(200).json(result);
  } catch (error) {
    console.error("Failed to process chat request.", error);
    const message = toClientMessage(error);
    const isValidationError =
      message.includes("required strings") || message.includes("cannot be empty");
    response.status(isValidationError ? 400 : 502).json({ error: message });
  }
});

io.use((socket, next) => {
  // The cookie first — that is how the browser authenticates a socket now, and
  // it cannot be read from JS, which is the whole point of the move. The
  // handshake header is kept as a fallback so a scripted client (and the test
  // suites) can still connect without a cookie jar.
  const header = socket.handshake.headers.cookie ?? "";
  const fromCookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1);
  const token =
    fromCookie || (socket.handshake.auth?.token as string | undefined);
  if (!token) {
    next(new Error("Authentication required."));
    return;
  }
  try {
    socket.data.user = verifyAuthToken(decodeURIComponent(token));
    next();
  } catch {
    next(new Error("Session expired or invalid. Please sign in again."));
  }
});

// Per-username throttle for socket messages (the socket equivalent of the
// chat HTTP limiter; each message triggers billable AI calls).
const socketMessageLimiter = createSocketLimiter({
  windowMs: 60 * 1000,
  max: 12,
});

io.on("connection", (socket) => {
  const user = socket.data.user as AuthUser;
  console.log(`Socket connected: ${socket.id} (${user.username})`);

  socket.on(
    "student-message",
    async (payload: StudentMessagePayload) => {
      const { allowed, retryAfterMs } = socketMessageLimiter(user.username);
      if (!allowed) {
        socket.emit("ai-error", {
          message: "You're sending messages too quickly. Please slow down a little.",
        });
        console.warn(
          `Rate limited socket message from ${user.username} (retry in ${Math.ceil(retryAfterMs / 1000)}s)`,
        );
        return;
      }
      // The daily budget is enforced here as well as on `POST /api/chat`, because
      // the socket is the path the client actually uses — metering only the route
      // left the cap that protects the AI bill unenforced for every real student.
      if (!(await consumeDailyAiCall(user.id))) {
        socket.emit("ai-error", {
          message:
            "You've used a lot of the tutor today. It resets tomorrow — come back then, or keep reviewing what you already have.",
        });
        return;
      }
      try {
        const result = await processStudentMessage(payload, user);
        socket.emit("socratic-response", result);
      } catch (error) {
        console.error("Failed to process student message.", error);
        socket.emit("ai-error", { message: toClientMessage(error) });
      }
    },
  );

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

/** How often stale usage rows are swept. */
const USAGE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function startServer(): Promise<void> {
  await connectDB();

  // Seed the catalog before accepting traffic, rather than on the first
  // dashboard request as it used to be. Housekeeping only — never let it stop
  // the server from coming up, since a student can still sign in and chat
  // without the catalog.
  void seedCatalogOnce().catch((error: unknown) => {
    console.error("Failed to seed the course catalog.", error);
  });

  // Housekeeping only — never let it stop the server from coming up.
  void pruneOldUsage().catch((error: unknown) => {
    console.error("Failed to prune old AI usage rows.", error);
  });

  // …and repeat it. Pruning only at boot meant an instance that stayed up for
  // months kept every usage row ever written, well past the 30-day retention
  // window the function documents — the rows are one per student per day, so
  // that grows without bound on a long-lived deployment.
  const pruneTimer = setInterval(() => {
    void pruneOldUsage().catch((error: unknown) => {
      console.error("Failed to prune old AI usage rows.", error);
    });
  }, USAGE_PRUNE_INTERVAL_MS);
  // Don't hold the process open on this alone.
  pruneTimer.unref();

  httpServer.listen(port, () => {
    console.log(`AgentEd server listening on port ${port}.`);
  });
}

startServer().catch((error: unknown) => {
  console.error("Failed to start AgentEd server.", error);
  process.exitCode = 1;
});

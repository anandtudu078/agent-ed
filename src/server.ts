import "dotenv/config";

import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { connectDB } from "./config/db";
import { Session } from "./models/Session";
import {
  analyzeStudentInput,
  generateSocraticResponse,
} from "./services/aiService";
import authRouter from "./routes/auth";
import dashboardRouter from "./routes/dashboard";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
  verifyAuthToken,
} from "./middleware/auth";
import {
  chatRateLimit,
  createSocketLimiter,
} from "./middleware/rateLimit";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? "*",
  },
});

const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);

interface StudentMessagePayload {
  studentId: string;
  activeTopic: string;
  studentMessage: string;
}

interface ChatResult {
  response: string;
  analysis: string;
  session: {
    studentId: string;
    activeTopic: string;
    conversationHistory: unknown[];
  };
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
];

function toClientMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unable to process chat request.";
  return CLIENT_SAFE_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
    ? message
    : "The AI tutor is temporarily unavailable. Please try again in a moment.";
}

async function processStudentMessage(
  payload: StudentMessagePayload,
  authUser: AuthUser,
): Promise<ChatResult> {
  validateStudentMessage(payload);

  // Sessions are keyed by the authenticated username, so one student can
  // never read or write another student's conversation.
  const studentId = authUser.username;
  const activeTopic = payload.activeTopic.trim();
  const studentMessage = payload.studentMessage.trim();
  const analysis = await analyzeStudentInput(studentMessage);
  const response = await generateSocraticResponse(analysis, studentMessage);

  const session = await Session.findOneAndUpdate(
    { studentId },
    {
      $set: { activeTopic },
      $push: {
        conversationHistory: {
          $each: [
            { role: "user", content: studentMessage },
            { role: "assistant", content: response },
          ],
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  if (!session) {
    throw new Error("Unable to save the tutoring session.");
  }

  return {
    response,
    analysis,
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

    response.json({
      studentId: session.studentId,
      activeTopic: session.activeTopic,
      conversationHistory: session.conversationHistory,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  } catch (error) {
    console.error("Failed to load session.", error);
    response.status(500).json({ error: "Unable to load session." });
  }
});

app.post("/api/chat", requireAuth, chatRateLimit, async (request, response) => {
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
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error("Authentication required."));
    return;
  }
  try {
    socket.data.user = verifyAuthToken(token);
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
      try {
        const result = await processStudentMessage(payload, user);
        socket.emit("socratic-response", result);
      } catch (error) {
        console.error("Failed to process student message.", error);
        socket.emit("ai-error", { message: toClientMessage(error) });
      }
    },
  );

  socket.on("audio-chunk", (chunk: Buffer | ArrayBuffer | Uint8Array) => {
    socket.broadcast.emit("audio-chunk", chunk);
  });

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

async function startServer(): Promise<void> {
  await connectDB();

  httpServer.listen(port, () => {
    console.log(`AgentEd server listening on port ${port}.`);
  });
}

startServer().catch((error: unknown) => {
  console.error("Failed to start AgentEd server.", error);
  process.exitCode = 1;
});

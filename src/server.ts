import "dotenv/config";

import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { connectDB } from "./config/db.js";
import { Session } from "./models/Session.js";
import {
  analyzeStudentInput,
  generateSocraticResponse,
} from "./services/aiService.js";

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

async function processStudentMessage(
  payload: StudentMessagePayload,
): Promise<ChatResult> {
  validateStudentMessage(payload);

  const studentId = payload.studentId.trim();
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

app.get("/api/sessions/:studentId", async (request, response) => {
  try {
    const studentId = request.params.studentId?.trim();
    if (!studentId) {
      response.status(400).json({ error: "studentId is required." });
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

app.post("/api/chat", async (request, response) => {
  try {
    const result = await processStudentMessage(request.body);
    response.status(200).json(result);
  } catch (error) {
    console.error("Failed to process chat request.", error);
    const message =
      error instanceof Error ? error.message : "Unable to process chat request.";
    const isValidationError =
      message.includes("required strings") || message.includes("cannot be empty");
    response.status(isValidationError ? 400 : 500).json({ error: message });
  }
});

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on(
    "student-message",
    async (payload: StudentMessagePayload) => {
      try {
        const result = await processStudentMessage(payload);
        socket.emit("socratic-response", result);
      } catch (error) {
        console.error("Failed to process student message.", error);
        socket.emit("ai-error", {
          message:
            error instanceof Error
              ? error.message
              : "Unable to process student message.",
        });
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

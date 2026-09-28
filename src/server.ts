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

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "AgentEd" });
});

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on(
    "student-message",
    async (payload: {
      studentId: string;
      activeTopic: string;
      studentMessage: string;
    }) => {
      try {
        if (
          !payload ||
          typeof payload.studentId !== "string" ||
          typeof payload.activeTopic !== "string" ||
          typeof payload.studentMessage !== "string" ||
          !payload.studentId.trim() ||
          !payload.activeTopic.trim() ||
          !payload.studentMessage.trim()
        ) {
          throw new Error(
            "student-message requires studentId, activeTopic, and studentMessage.",
          );
        }

        const studentMessage = payload.studentMessage.trim();
        const analysis = await analyzeStudentInput(studentMessage);
        const socraticResponse = await generateSocraticResponse(
          analysis,
          studentMessage,
        );

        await Session.findOneAndUpdate(
          { studentId: payload.studentId.trim() },
          {
            $set: { activeTopic: payload.activeTopic.trim() },
            $push: {
              conversationHistory: {
                $each: [
                  { role: "user", content: studentMessage },
                  { role: "assistant", content: socraticResponse },
                ],
              },
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        socket.emit("socratic-response", {
          response: socraticResponse,
          analysis,
        });
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

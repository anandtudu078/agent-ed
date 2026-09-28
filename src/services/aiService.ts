import Groq from "groq-sdk";

interface StudentAnalysis {
  intent: string;
  coreMisunderstandings: string[];
}

export async function analyzeStudentInput(
  studentMessage: string,
): Promise<string> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    // Use Node's native fetch: the SDK's bundled node-fetch@2 fails with
    // "Premature close" on modern Node when reading response bodies.
    fetch: globalThis.fetch as unknown as NonNullable<
      ConstructorParameters<typeof Groq>[0]
    >["fetch"],
  });

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Analyze the student's message for a Socratic tutor. Return only JSON with " +
          'an "intent" string and a "coreMisunderstandings" array of concise strings. ' +
          "Do not solve the student's problem.",
      },
      { role: "user", content: studentMessage },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Groq returned an empty student analysis.");
  }

  try {
    const parsed = JSON.parse(content) as Partial<StudentAnalysis>;
    if (
      typeof parsed.intent !== "string" ||
      !Array.isArray(parsed.coreMisunderstandings) ||
      !parsed.coreMisunderstandings.every(
        (item): item is string => typeof item === "string",
      )
    ) {
      throw new Error("Groq returned an invalid analysis shape.");
    }
    return JSON.stringify(parsed);
  } catch (error) {
    throw new Error("Groq returned invalid JSON for student analysis.", {
      cause: error,
    });
  }
}

// Flash models tried in order — each has its own free-tier quota, and
// availability/503 throttling varies per model, so falling back keeps the
// tutor usable when one model is exhausted or overloaded.
// Extend with GEMINI_EXTRA_KEYS="key1,key2" to rotate through additional
// API keys (e.g. a second Google Cloud project) once per-model quotas die.
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
] as const;

interface GeminiCredential {
  label: string;
  apiKey: string;
}

function loadGeminiCredentials(): GeminiCredential[] {
  const credentials: GeminiCredential[] = [];
  const primary = process.env.GEMINI_API_KEY;
  if (primary) credentials.push({ label: "primary", apiKey: primary });

  const extra = (process.env.GEMINI_EXTRA_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  extra.forEach((apiKey, index) => {
    credentials.push({ label: `extra-${index + 1}`, apiKey });
  });

  return credentials;
}

export async function generateSocraticResponse(
  conceptContext: string,
  studentQuery: string,
): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const googleGenAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const promptText =
    `Student analysis:\n${conceptContext}\n\n` +
    `Student question:\n${studentQuery}`;

  const credentials = loadGeminiCredentials();
  if (credentials.length === 0) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  let lastError: unknown;
  // Outer loop: credentials (keys), inner loop: models. Every key gets a
  // fresh set of per-model free quotas, so rotation multiplies capacity.
  for (const credential of credentials) {
    const googleGenAI = new (await import("@google/genai")).GoogleGenAI({
      apiKey: credential.apiKey,
    });

    for (const model of GEMINI_MODELS) {
      try {
        const response = await googleGenAI.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ text: promptText }],
            },
          ],
          config: {
            systemInstruction:
              "You are AgentEd, a Socratic AI tutor. Guide the student toward understanding " +
              "with clear, encouraging questions. Never give a direct answer, complete a " +
              "solution, or reveal the final result. Ask one focused guiding question at a time. " +
              "Use the student analysis to target their misunderstanding.",
          },
        });

        const text = response.text?.trim();
        if (text) {
          return text;
        }
        lastError = new Error("Gemini returned an empty Socratic response.");
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(
    "All Gemini models are unavailable or out of quota. Please try again shortly.",
    { cause: lastError },
  );
}

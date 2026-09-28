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

export async function generateSocraticResponse(
  conceptContext: string,
  studentQuery: string,
): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const googleGenAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const response = await googleGenAI.models.generateContent({
    model: "gemini-3.8-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Student analysis:\n${conceptContext}\n\n` +
              `Student question:\n${studentQuery}`,
          },
        ],
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
  if (!text) {
    throw new Error("Gemini returned an empty Socratic response.");
  }
  return text;
}

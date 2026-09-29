import Groq from "groq-sdk";

/**
 * Shared Groq client factory.
 *
 * The SDK's bundled node-fetch@2 fails with "Premature close" on modern Node
 * when reading response bodies, so we hand it Node's native fetch instead.
 */
export function createGroqClient(): Groq {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
    fetch: globalThis.fetch as unknown as NonNullable<
      ConstructorParameters<typeof Groq>[0]
    >["fetch"],
  });
}

/**
 * Run a JSON-mode chat completion and return the parsed object.
 *
 * `response_format: json_object` still isn't a guarantee — models wrap JSON in
 * prose or fences often enough that the recovery path earns its keep. Throws a
 * descriptive error so callers can decide whether it's fatal.
 */
export async function completeJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options: { model?: string; temperature?: number } = {},
): Promise<T> {
  const groq = createGroqClient();
  const completion = await groq.chat.completions.create({
    model: options.model ?? "openai/gpt-oss-20b",
    temperature: options.temperature ?? 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Groq returned an empty response.");
  }
  return parseJsonLoose<T>(content);
}

/** Parse JSON that may be fenced or wrapped in prose. */
export function parseJsonLoose<T>(raw: string): T {
  const attempt = (text: string): T | null => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };

  const direct = attempt(raw);
  if (direct) return direct;

  // ```json ... ``` fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = attempt(fenced[1].trim());
    if (parsed) return parsed;
  }

  // Largest {...} or [...] span in the text.
  const span = raw.match(/[[{][\s\S]*[\]}]/);
  if (span?.[0]) {
    const parsed = attempt(span[0]);
    if (parsed) return parsed;
  }

  throw new Error("Groq returned invalid JSON.");
}

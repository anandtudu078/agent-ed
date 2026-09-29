import Groq from "groq-sdk";

/**
 * Models tried, in order, for a long-form prose reply.
 *
 * Verified against this account's live model list rather than assumed: Groq
 * currently serves no Llama models here, so the commonly-recommended
 * `llama-3.3-70b-versatile` would have 404'd. gpt-oss-120b is the largest
 * general model available and is the best fallback for teaching prose; the
 * others are progressively smaller stand-ins.
 */
export const GROQ_TEXT_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
] as const;

const DEFAULT_TEXT_MODEL = GROQ_TEXT_MODELS[0];

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
 * JSON-mode models, tried in order.
 *
 * Separate from GROQ_TEXT_MODELS because JSON mode is not equally supported:
 * a model that chats fine can still reject `response_format`. These three are
 * all verified to serve JSON mode on this account.
 */
export const GROQ_JSON_MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
] as const;

/**
 * Run a JSON-mode chat completion and return the parsed object.
 *
 * Walks the model chain rather than trying a single model. The prose path has
 * always done this, so assessment grading, input analysis and diagram
 * generation were the one place where a single unavailable model took the whole
 * request down — a worse failure than a slightly different grade.
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
  // An explicit model still gets a single-element chain, so callers that name a
  // specific model keep that choice.
  const models = options.model
    ? [options.model]
    : [...GROQ_JSON_MODELS];
  const groq = createGroqClient();
  let lastError: unknown;

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        temperature: options.temperature ?? 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = completion.choices[0]?.message.content;
      if (!content) {
        lastError = new Error(`Groq model ${model} returned an empty response.`);
        continue;
      }
      return parseJsonLoose<T>(content);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error("Every Groq model failed for a JSON completion.", {
    cause: lastError,
  });
}

/**
 * General-purpose text completion (no JSON mode), for prose replies.
 *
 * Tries each model in turn and returns the first non-empty completion, so a
 * single unavailable model doesn't take the request down. Throws only when
 * every candidate fails, carrying the last error.
 */
export async function completeText(
  systemPrompt: string,
  userPrompt: string,
  options: {
    models?: string[];
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<string> {
  const models = options.models?.length ? options.models : [DEFAULT_TEXT_MODEL];
  const groq = createGroqClient();
  let lastError: unknown;

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        temperature: options.temperature ?? 0.6,
        max_tokens: options.maxTokens ?? 900,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const content = completion.choices[0]?.message.content?.trim();
      if (content) return content;
      lastError = new Error(`Groq model ${model} returned an empty completion.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error("Every Groq model failed for a text completion.", {
    cause: lastError,
  });
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

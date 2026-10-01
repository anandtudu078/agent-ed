/**
 * Choosing which subtopic a student wants when they name one directly.
 *
 * A course module lists its subtopics, and the student's request almost never
 * matches one character-for-character: they type "backprop", the syllabus says
 * "backpropagation and gradient flow", and a literal comparison finds nothing. So
 * the matching is fuzzy, and the *reason* it picked what it picked is returned
 * with it — a tutor that silently jumps to a neighbouring topic looks broken,
 * whereas one that says "I'll start with X" reads as attentive.
 *
 * Pure, so the matching rules are unit-testable. Nothing here touches the DOM or
 * the network, and the prompt itself is built here too so the wording is tested
 * rather than trusted.
 */

/** Below this length a substring test is unsafe: "var" matches "variables". */
const MIN_FUZZY_LENGTH = 4;

/** Words so common in this domain they carry no signal about which topic. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "of", "and", "or", "in", "on", "to",
  "for", "with", "about", "explain", "teach", "learn", "tell", "me", "how",
  "what", "why", "when", "which", "who", "can", "you", "i", "want", "need",
  "please", "help", "understand", "concept", "topic", "subject", "thing",
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeTopic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meaningful words only — the ones that actually identify a topic. */
function contentTerms(value: string): string[] {
  return normalizeTopic(value)
    .split(" ")
    .filter((term) => term.length > 0 && !STOP_WORDS.has(term));
}

export interface SubtopicMatch {
  /** The subtopic as the syllabus words it, or null when nothing matched. */
  subtopic: string | null;
  /** The module it belongs to, or null. */
  moduleTitle: string | null;
  /**
   * Why this was chosen. Surfaced so the tutor can be honest about it rather than
   * pretending an exact match it didn't make.
   */
  match: "exact" | "starts-with" | "contains" | "related" | "none";
}

export interface ModuleLike {
  title: string;
  topic: string;
  subtopics?: string[];
}

/**
 * Find the subtopic a request is about.
 *
 * Tries exact, then prefix, then containment, then word-overlap — in that order,
 * and within one module before moving to the next, so a request about module 2
 * never gets answered with a loosely similar word from module 7.
 *
 * "related" is deliberately the weakest match and the caller decides whether to
 * act on it: a single shared word in a 186-module syllabus is weak evidence, and
 * treating it as a hit would have the tutor confidently teach something else.
 */
export function matchSubtopic(
  request: string,
  modules: ModuleLike[],
): SubtopicMatch {
  const none: SubtopicMatch = {
    subtopic: null,
    moduleTitle: null,
    match: "none",
  };

  const wanted = normalizeTopic(request);
  if (!wanted) return none;
  const terms = contentTerms(request);

  for (const module of modules ?? []) {
    const candidates: string[] = [
      ...(module.subtopics ?? []),
      module.title,
      module.topic,
    ].filter((value) => typeof value === "string" && value.trim().length > 0);

    // Exact.
    const exact = candidates.find((c) => normalizeTopic(c) === wanted);
    if (exact) {
      return { subtopic: exact, moduleTitle: module.title, match: "exact" };
    }

    // The request names a whole module ("conditionals"), not a leaf.
    const isModuleItself = candidates.some(
      (c) => normalizeTopic(c) === wanted,
    );
    if (isModuleItself) {
      return { subtopic: module.title, moduleTitle: module.title, match: "exact" };
    }

    // Prefix / containment, only once both sides are long enough to be safe.
    if (wanted.length >= MIN_FUZZY_LENGTH) {
      const startsWith = candidates.find(
        (c) => normalizeTopic(c).startsWith(wanted),
      );
      if (startsWith) {
        return { subtopic: startsWith, moduleTitle: module.title, match: "starts-with" };
      }

      const contains = candidates.find((c) => {
        const normalized = normalizeTopic(c);
        if (normalized.length < MIN_FUZZY_LENGTH) return false;
        return normalized.includes(wanted) || wanted.includes(normalized);
      });
      if (contains) {
        return { subtopic: contains, moduleTitle: module.title, match: "contains" };
      }
    }

    // Weakest: shared content words. Requires a real overlap, not one incidental
    // word — with a syllabus this large that is the difference between matching
    // "gradient descent" and matching every module that mentions "data".
    if (terms.length) {
      const shared = candidates.find((candidate) => {
        const candidateTerms = contentTerms(candidate);
        const overlap = terms.filter((term) => candidateTerms.includes(term)).length;
        return overlap >= 2;
      });
      if (shared) {
        return { subtopic: shared, moduleTitle: module.title, match: "related" };
      }
    }
  }

  return none;
}

/**
 * The message that opens a chat scoped to one subtopic.
 *
 * Written here rather than at the call site so the wording is covered by tests —
 * this text is what makes the feature feel deliberate instead of accidental, and
 * an unreviewed template string is exactly the kind of thing that ends up saying
 * "I'll start with undefined".
 */
export function subtopicPrompt(
  moduleTitle: string,
  subtopic: string,
  courseTitle: string,
): string {
  return (
    `I'm working through ${courseTitle}. In the module "${moduleTitle}", I want to ` +
    `focus specifically on "${subtopic}" — can you start with a question that gets me ` +
    `thinking about just that part?`
  );
}
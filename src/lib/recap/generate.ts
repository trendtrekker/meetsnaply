import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Post-meeting recap generation with Claude.
 *
 * Uses `beta.messages.parse` with a Zod-derived JSON schema so the model's output
 * is validated against a contract rather than parsed out of prose. The pipeline
 * writes these fields straight into the database and into an email, so a shape
 * mismatch would surface as a broken recap in somebody's inbox.
 */

export const MODEL = "claude-opus-5";

/** Beyond this we summarise in chunks rather than in one pass. */
const SINGLE_PASS_CHAR_LIMIT = 400_000;

const actionItemSchema = z.object({
  text: z.string().describe("The action, phrased as an imperative."),
  owner: z
    .string()
    .nullable()
    .describe("Who owns it, or null if the transcript never says."),
  due: z
    .string()
    .nullable()
    .describe("Due date exactly as stated in the meeting, or null."),
});

const recapSchema = z.object({
  summary: z
    .string()
    .describe(
      "Two to four sentences on what happened and what it means. No preamble.",
    ),
  decisions: z
    .array(z.string())
    .describe("Decisions actually settled. Empty if none were."),
  actionItems: z
    .array(actionItemSchema)
    .describe("Committed follow-ups. Empty if none were."),
  openQuestions: z
    .array(z.string())
    .describe("Raised but left unresolved. Empty if none were."),
});

export type RecapContent = z.infer<typeof recapSchema>;

export interface RecapUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface RecapResult extends RecapContent {
  model: string;
  usage: RecapUsage;
}

/** The model declined the request. Not retryable. */
export class RecapRefusedError extends Error {
  readonly category: string | null;
  constructor(category: string | null) {
    super(
      `Claude declined to summarise this transcript${category ? ` (${category})` : ""}.`,
    );
    this.name = "RecapRefusedError";
    this.category = category;
  }
}

export function isRecapConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You write post-meeting recaps that get emailed to everyone who was on the call.

Ground every claim in the transcript. If something was not discussed, leave the corresponding list empty rather than inferring it — an invented action item is worse than a short recap, because the recipients will act on it.

Distinguish carefully:
- A decision is something the participants settled. "We should probably look at that" is not a decision.
- An action item is a commitment someone made. Attribute it to the speaker who took it on, using the name the transcript gives you; use null for the owner when it genuinely was not assigned.
- An open question is something raised and left hanging. Recording these is what stops a recap from implying a meeting was more conclusive than it was.

Write the summary for someone who missed the call: lead with the outcome, then the context. Use the participants' names rather than speaker labels. Plain sentences, no headers, no bullet characters inside a field, and no closing pleasantries.`;

function buildUserPrompt(options: {
  title: string;
  transcript: string;
  participants: string[];
  speakerLabels: string[];
}) {
  const roster =
    options.participants.length > 0
      ? options.participants.join(", ")
      : "not recorded";

  return `Meeting: ${options.title}
Participants: ${roster}
Speaker labels appearing in the transcript: ${options.speakerLabels.join(", ") || "none"}

The transcript is machine-generated and diarized, so speakers are labelled generically. Map each label to a participant where the conversation makes it obvious (someone is addressed by name, or introduces themselves); if a label is ambiguous, describe that speaker by role instead of guessing a name.

Transcript:
"""
${options.transcript}
"""`;
}

async function requestRecap(userPrompt: string): Promise<RecapResult> {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    // Thinking is on by default on this model and counts against max_tokens, so
    // this ceiling covers reasoning plus the JSON — not the JSON alone.
    max_tokens: 16_000,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(recapSchema) },
    // Safety classifiers can decline a request; routing the retry server-side
    // recovers it in the same call instead of losing the recap.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new RecapRefusedError(response.stop_details?.category ?? null);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Recap generation hit max_tokens before returning complete JSON.",
    );
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned output that did not match the recap schema.");
  }

  return {
    ...response.parsed_output,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/** Splits on speaker-turn boundaries so no chunk cuts mid-sentence. */
function chunkTranscript(transcript: string, limit: number): string[] {
  const lines = transcript.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    if (size + line.length > limit && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

/**
 * Produces a recap for one meeting.
 *
 * Transcripts fit in a single request in practice — a three-hour meeting is well
 * under the context window. The chunked path exists so an unusually long
 * recording degrades into a slightly coarser recap instead of failing outright:
 * each chunk is recapped, then the recaps are recapped.
 */
export async function generateRecap(options: {
  title: string;
  transcript: string;
  participants: string[];
  speakerLabels: string[];
}): Promise<RecapResult> {
  const transcript = options.transcript.trim();

  if (transcript.length === 0) {
    throw new Error("Transcript is empty; nothing to summarise.");
  }

  if (transcript.length <= SINGLE_PASS_CHAR_LIMIT) {
    return requestRecap(buildUserPrompt({ ...options, transcript }));
  }

  const chunks = chunkTranscript(transcript, SINGLE_PASS_CHAR_LIMIT);
  const partials: RecapResult[] = [];
  for (const [index, chunk] of chunks.entries()) {
    partials.push(
      await requestRecap(
        buildUserPrompt({
          ...options,
          title: `${options.title} (part ${index + 1} of ${chunks.length})`,
          transcript: chunk,
        }),
      ),
    );
  }

  // Second pass over the partials. Their own decisions and action items are
  // carried through verbatim rather than re-derived, so nothing is lost to a
  // summary of a summary.
  const merged = await requestRecap(
    `Meeting: ${options.title}
Participants: ${options.participants.join(", ") || "not recorded"}
Speaker labels appearing in the transcript: ${options.speakerLabels.join(", ") || "none"}

This meeting was long enough to summarise in ${chunks.length} sequential parts. Below are the per-part recaps, in order. Produce one coherent recap of the whole meeting: write a single summary, and carry every decision, action item, and open question through — merging duplicates and dropping anything a later part resolved.

${partials
  .map(
    (partial, index) =>
      `Part ${index + 1}:
Summary: ${partial.summary}
Decisions: ${partial.decisions.join(" | ") || "none"}
Action items: ${partial.actionItems.map((item) => `${item.text}${item.owner ? ` [${item.owner}]` : ""}`).join(" | ") || "none"}
Open questions: ${partial.openQuestions.join(" | ") || "none"}`,
  )
  .join("\n\n")}`,
  );

  // Report the whole job's cost, not just the final call's.
  const usage = [...partials, merged].reduce(
    (total, part) => ({
      inputTokens: total.inputTokens + part.usage.inputTokens,
      outputTokens: total.outputTokens + part.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  return { ...merged, usage };
}

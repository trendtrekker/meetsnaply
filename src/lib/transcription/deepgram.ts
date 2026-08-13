import "server-only";

/**
 * Deepgram prerecorded transcription over plain fetch.
 *
 * Deepgram rather than raw Whisper because it returns speaker diarization in the
 * same call. Whisper needs a separate diarization pass to answer "who said
 * this", and speaker attribution is what makes a recap's action items assignable
 * to a person rather than to the room.
 */

const API_URL = "https://api.deepgram.com/v1/listen";

export class TranscriptionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscriptionError";
    this.status = status;
  }
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export function isTranscriptionConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

export interface TranscriptSegmentInput {
  /** Provider speaker label, e.g. "Speaker 0". */
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
}

export interface TranscriptionResult {
  language: string;
  fullText: string;
  segments: TranscriptSegmentInput[];
  /** Distinct speaker labels the provider identified. */
  speakerLabels: string[];
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
  punctuated_word?: string;
}

interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
        confidence?: number;
        words?: DeepgramWord[];
      }[];
    }[];
  };
  metadata?: { detected_language?: string };
  err_msg?: string;
}

/**
 * Groups a flat word list into speaker turns.
 *
 * Deepgram returns per-word speaker indices, not turns. Emitting one segment per
 * word would make the transcript unreadable and blow up the row count, so
 * consecutive words from the same speaker are merged — with a split on long
 * pauses so a monologue doesn't collapse into one wall of text.
 */
function groupIntoTurns(words: DeepgramWord[]): TranscriptSegmentInput[] {
  const PAUSE_SPLIT_SECONDS = 2;
  const MAX_TURN_SECONDS = 60;

  const segments: TranscriptSegmentInput[] = [];
  let current: {
    speaker: number;
    start: number;
    end: number;
    words: string[];
    confidences: number[];
  } | null = null;

  const flush = () => {
    if (!current || current.words.length === 0) return;
    const confidences = current.confidences;
    segments.push({
      speaker: `Speaker ${current.speaker}`,
      startMs: Math.round(current.start * 1000),
      endMs: Math.round(current.end * 1000),
      text: current.words.join(" "),
      confidence:
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : null,
    });
    current = null;
  };

  for (const word of words) {
    const speaker = word.speaker ?? 0;
    const text = word.punctuated_word ?? word.word;
    if (!text) continue;

    const shouldSplit =
      !current ||
      current.speaker !== speaker ||
      word.start - current.end > PAUSE_SPLIT_SECONDS ||
      word.end - current.start > MAX_TURN_SECONDS;

    if (shouldSplit) {
      flush();
      current = {
        speaker,
        start: word.start,
        end: word.end,
        words: [],
        confidences: [],
      };
    }

    current!.words.push(text);
    current!.end = word.end;
    if (typeof word.confidence === "number") {
      current!.confidences.push(word.confidence);
    }
  }
  flush();

  return segments;
}

/**
 * Transcribes audio at `audioUrl`.
 *
 * The URL is passed to Deepgram rather than downloaded and re-uploaded — the
 * audio never transits this server, which keeps memory flat regardless of
 * meeting length.
 */
export async function transcribeUrl(
  audioUrl: string,
  options: { language?: string } = {},
): Promise<TranscriptionResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set.");

  const params = new URLSearchParams({
    model: "nova-3",
    // The three that matter for a readable, attributable transcript.
    diarize: "true",
    punctuate: "true",
    smart_format: "true",
    ...(options.language
      ? { language: options.language }
      : { detect_language: "true" }),
  });

  let response: Response;
  try {
    response = await fetch(`${API_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
      cache: "no-store",
    });
  } catch (cause) {
    throw new TranscriptionError(
      `Could not reach Deepgram: ${String(cause)}`,
      503,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TranscriptionError(
      `Deepgram ${response.status}: ${body.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as DeepgramResponse;
  const alternative = payload.results?.channels?.[0]?.alternatives?.[0];

  if (!alternative) {
    throw new TranscriptionError("Deepgram returned no transcript", 422);
  }

  const words = alternative.words ?? [];
  const segments = groupIntoTurns(words);

  // A recording of silence transcribes successfully to nothing. That's a real
  // outcome, not an error — the caller decides whether a recap is worth making.
  const fullText = segments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join("\n");

  return {
    language: payload.metadata?.detected_language ?? options.language ?? "en",
    fullText: fullText || (alternative.transcript ?? ""),
    segments,
    speakerLabels: [...new Set(segments.map((s) => s.speaker))],
  };
}

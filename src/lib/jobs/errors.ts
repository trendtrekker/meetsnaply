/**
 * Thrown by a job handler when retrying cannot help — a malformed payload, a
 * record that no longer exists, a provider rejecting the input as invalid. The
 * runner sends these straight to FAILED instead of burning the retry budget.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Explicit "nothing to do" — the job succeeds without side effects. */
export class JobSkipped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobSkipped";
  }
}

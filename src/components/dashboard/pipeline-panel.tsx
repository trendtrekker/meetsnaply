import { AlertTriangle, Check, Clock, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { retryPipelineJob, reprocessRecording } from "@/lib/jobs/actions";
import { formatDateTime } from "@/lib/datetime";

const STAGE_LABELS: Record<string, string> = {
  "recording.process": "Fetch recording",
  "transcript.generate": "Transcribe",
  "recap.generate": "Generate recap",
  "recap.send": "Email attendees",
  "recording.purge": "Delete audio",
};

export interface PipelineJobView {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
  completedAt: Date | null;
}

export function PipelinePanel({
  jobs,
  bookingUid,
  timeZone,
  hasRecording,
}: {
  jobs: PipelineJobView[];
  bookingUid: string;
  timeZone: string;
  hasRecording: boolean;
}) {
  if (!hasRecording) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCw className="size-4 text-text-muted" />
          Recap pipeline
        </CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Each stage runs as a background job and retries on its own.
        </p>
      </CardHeader>

      <CardBody className="space-y-3">
        {jobs.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing queued yet. The pipeline starts when the provider reports the
            recording is ready.
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {jobs.map((job) => {
              const label = STAGE_LABELS[job.type] ?? job.type;
              const pendingRetry =
                job.status === "PENDING" && job.attempts > 0;

              return (
                <li key={job.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{label}</p>
                    {job.status === "DONE" ? (
                      <Badge tone="success">
                        <Check className="size-3" />
                        done
                      </Badge>
                    ) : job.status === "FAILED" ? (
                      <Badge tone="danger">
                        <AlertTriangle className="size-3" />
                        failed
                      </Badge>
                    ) : job.status === "RUNNING" ? (
                      <Badge tone="brand">running</Badge>
                    ) : (
                      <Badge tone={pendingRetry ? "warning" : "neutral"}>
                        <Clock className="size-3" />
                        {pendingRetry ? "retrying" : "queued"}
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-text-muted">
                    {job.status === "DONE" && job.completedAt
                      ? `Completed ${formatDateTime(job.completedAt, timeZone)}`
                      : job.status === "PENDING" && job.runAfter > new Date()
                        ? `Next attempt ${formatDateTime(job.runAfter, timeZone)}`
                        : `Attempt ${job.attempts} of ${job.maxAttempts}`}
                  </p>

                  {job.lastError ? (
                    <p className="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">
                      {job.lastError}
                    </p>
                  ) : null}

                  {job.status === "FAILED" ? (
                    <form action={retryPipelineJob}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="uid" value={bookingUid} />
                      <Button type="submit" size="sm" variant="secondary">
                        Retry this stage
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <form action={reprocessRecording}>
          <input type="hidden" name="uid" value={bookingUid} />
          <Button type="submit" size="sm" variant="ghost">
            Restart from the recording
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

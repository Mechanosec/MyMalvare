'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, fetchJob } from '../lib/api-client';
import { EJobStatus } from '../lib/constant/job-status.constant';
import { IJobProgressEvent } from '../lib/types/job-progress-event.type';

interface IProgressPanelProps {
  readonly jobId: string | null;
}

// The parent renders this with `key={jobId}` so a new job remounts it
// with fresh state, instead of resetting state from inside the effect.
export function ProgressPanel({ jobId }: IProgressPanelProps) {
  const [event, setEvent] = useState<IJobProgressEvent | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const socket = io(API_URL);
    let connected = false;

    socket.on('connect', () => {
      connected = true;
    });
    socket.on(`job:${jobId}`, (payload: IJobProgressEvent) => setEvent(payload));

    // Fallback for the window before the socket connects, or if it never
    // does: poll GET /jobs/:id until the job finishes.
    const poll = setInterval(() => {
      if (connected) return;
      fetchJob(jobId)
        .then((job) =>
          setEvent({
            jobId,
            status: job.status,
            message: job.message,
            processed: job.processed,
          }),
        )
        .catch(() => {
          /* job may not exist yet right after starting; ignore and retry */
        });
    }, 1000);

    return () => {
      socket.disconnect();
      clearInterval(poll);
    };
  }, [jobId]);

  if (!jobId) {
    return <p className="text-sm text-gray-500">No job running.</p>;
  }

  if (!event) {
    return <p className="text-sm text-gray-500">Starting…</p>;
  }

  const color =
    event.status === EJobStatus.FAILED
      ? 'text-red-600'
      : event.status === EJobStatus.DONE
        ? 'text-green-600'
        : 'text-gray-800';

  return (
    <p className={`text-sm ${color}`}>
      [{event.status}] {event.message}
      {event.processed !== undefined ? ` (${event.processed} processed)` : ''}
    </p>
  );
}

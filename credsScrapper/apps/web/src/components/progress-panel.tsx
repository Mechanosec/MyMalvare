'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, fetchJob } from '../lib/api-client';
import { EJobStatus } from '../lib/constant/job-status.constant';
import { IJobProgressEvent } from '../lib/types/job-progress-event.type';

interface IProgressPanelProps {
  readonly jobId: string | null;
}

const DOT_TONE: Record<EJobStatus, string> = {
  [EJobStatus.RUNNING]: 'bg-warning animate-pulse',
  [EJobStatus.DONE]: 'bg-accent',
  [EJobStatus.FAILED]: 'bg-critical',
};

const LINE_TONE: Record<EJobStatus, string> = {
  [EJobStatus.RUNNING]: 'text-text',
  [EJobStatus.DONE]: 'text-accent',
  [EJobStatus.FAILED]: 'text-critical',
};

function formatLine(event: IJobProgressEvent): string {
  const suffix = event.processed !== undefined ? ` (${event.processed} processed)` : '';
  return `[${event.status}] ${event.message}${suffix}`;
}

// The parent renders this with `key={jobId}` so a new job remounts it
// with fresh state, instead of resetting state from inside the effect.
export function ProgressPanel({ jobId }: IProgressPanelProps) {
  const [events, setEvents] = useState<IJobProgressEvent[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    // A page reload loses all in-memory React state, but the job keeps
    // running server-side - GET /jobs/:id.log replays everything emitted
    // so far, before the WebSocket below picks up anything new. Without
    // this, a reload made an in-progress job look like it had produced
    // no output at all.
    fetchJob(jobId)
      .then((job) => {
        if (!cancelled && job.log.length > 0) {
          setEvents([...job.log]);
        }
      })
      .catch(() => {
        /* job not found (e.g. server restarted) - fall through to live updates */
      });

    const socket = io(API_URL);
    let connected = false;

    socket.on('connect', () => {
      connected = true;
    });
    socket.on(`job:${jobId}`, (payload: IJobProgressEvent) =>
      setEvents((prev) => [...prev, payload]),
    );

    // Fallback for the window before the socket connects, or if it never
    // does: poll GET /jobs/:id until the job finishes. Only appends when
    // the message actually changed, so this doesn't spam duplicate lines
    // while waiting for the socket.
    const poll = setInterval(() => {
      if (connected) return;
      fetchJob(jobId)
        .then((job) =>
          setEvents((prev) => {
            const last = prev[prev.length - 1];
            if (last?.message === job.message && last?.processed === job.processed) {
              return prev;
            }
            return [...prev, { jobId, status: job.status, message: job.message, processed: job.processed }];
          }),
        )
        .catch(() => {
          /* job may not exist yet right after starting; ignore and retry */
        });
    }, 1000);

    return () => {
      cancelled = true;
      socket.disconnect();
      clearInterval(poll);
    };
  }, [jobId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  if (!jobId) {
    return (
      <div className="flex items-center gap-3 border border-line bg-surface px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-line" />
        <p className="text-sm text-text-dim">No job running.</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-3 border border-line bg-surface px-4 py-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />
        <p className="text-sm text-text-dim">Starting…</p>
      </div>
    );
  }

  const latest = events[events.length - 1];

  return (
    <div className="border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <span className={`h-2 w-2 rounded-full ${DOT_TONE[latest.status]}`} />
        <p className="text-sm text-text-dim">Job {latest.status}</p>
        <span className="ml-auto font-mono text-xs text-text-dim">
          {events.length} {events.length === 1 ? 'line' : 'lines'}
        </span>
      </div>
      <div
        ref={logRef}
        className="max-h-56 overflow-y-auto bg-ink px-4 py-2 font-mono text-xs leading-relaxed"
      >
        {events.map((event, index) => (
          <p key={index} className={LINE_TONE[event.status]}>
            <span className="text-text-dim">{String(index + 1).padStart(3, '0')} </span>
            {formatLine(event)}
          </p>
        ))}
      </div>
    </div>
  );
}

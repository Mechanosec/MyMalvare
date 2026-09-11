import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ProgressPort } from '../../application/ports/progress.port';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';

// No auth/user model exists yet in this app (detection-only MVP scope,
// per the design spec) - connection-level authorization for who may
// subscribe to job progress is intentionally deferred, matching that
// boundary. What's fixed here is narrower: CORS must not be wildcard-
// open ('*'), so only the configured frontend origin(s) can even
// establish a browser connection to this gateway. FRONTEND_ORIGIN
// defaults to the conventional Next.js dev port since no frontend
// sub-project exists yet to configure otherwise.
const allowedOrigins = process.env.FRONTEND_ORIGIN?.split(',') ?? ['http://localhost:3000'];

@Injectable()
@WebSocketGateway({ cors: { origin: allowedOrigins, credentials: true } })
export class ProgressGateway extends ProgressPort {
  @WebSocketServer()
  server!: Server;

  emit(event: IJobProgressEvent): void {
    // Not connected yet in a test / before the HTTP server is up -
    // GET /jobs/:id remains the polling fallback for that window.
    if (!this.server) {
      return;
    }
    this.server.emit(`job:${event.jobId}`, event);
    this.server.emit('job', event);
  }
}

import { Readable } from 'node:stream';

/** Byte-counted framing: file contents may contain newlines and protocol-like text. */
export class GitOutputReader {
  private readonly chunks: AsyncIterator<Buffer>;
  private pending: Buffer = Buffer.alloc(0);

  constructor(stream: Readable) {
    this.chunks = stream[Symbol.asyncIterator]();
  }

  private async fill(): Promise<void> {
    if (this.pending.length > 0) return;
    const next = await this.chunks.next();
    if (next.done)
      throw new Error(
        'Git output ended before the requested object was complete',
      );
    this.pending = next.value;
  }

  async line(): Promise<string> {
    const parts: Buffer[] = [];
    let length = 0;
    for (;;) {
      await this.fill();
      const end = this.pending.indexOf(10);
      const count = end < 0 ? this.pending.length : end;
      parts.push(this.pending.subarray(0, count));
      length += count;
      if (length > 1024) throw new Error('Invalid Git batch header');
      this.pending = this.pending.subarray(count + (end < 0 ? 0 : 1));
      if (end >= 0) return Buffer.concat(parts).toString('utf8');
    }
  }

  async bytes(length: number): Promise<Buffer> {
    const output = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      await this.fill();
      const count = Math.min(length - offset, this.pending.length);
      this.pending.copy(output, offset, 0, count);
      offset += count;
      this.pending = this.pending.subarray(count);
    }
    return output;
  }
}

import { Readable } from 'node:stream';
import { GitOutputReader } from '../../../../../src/modules/scanner/infrastructure/git/git-output-reader';

describe('GitOutputReader', () => {
  it('handles arbitrarily split headers, UTF-8, embedded newlines and zero bytes', async () => {
    const body = Buffer.from('Привіт\n\0payload');
    const output = Buffer.concat([
      Buffer.from(`abc blob ${body.length}\n`),
      body,
      Buffer.from('\nnext\n'),
    ]);
    const reader = new GitOutputReader(
      Readable.from([...output].map((byte) => Buffer.from([byte]))),
    );
    expect(await reader.line()).toBe(`abc blob ${body.length}`);
    expect(await reader.bytes(body.length)).toEqual(body);
    expect(await reader.bytes(1)).toEqual(Buffer.from('\n'));
    expect(await reader.line()).toBe('next');
  });

  it('fails on a truncated body and caps headers', async () => {
    const reader = new GitOutputReader(Readable.from([Buffer.from('short')]));
    await expect(reader.bytes(9)).rejects.toThrow('ended');
    const oversized = new GitOutputReader(
      Readable.from([Buffer.from('x'.repeat(1025) + '\n')]),
    );
    await expect(oversized.line()).rejects.toThrow('header');
  });
});

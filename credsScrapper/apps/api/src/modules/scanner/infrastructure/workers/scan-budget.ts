import * as fs from 'node:fs/promises';
import * as path from 'node:path';
export async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  const visit = async (dir: string): Promise<void> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile()) total += (await fs.stat(file)).size;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  };
  await visit(root);
  return total;
}

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';

const project = process.cwd();
const extension = path.join(project, 'extection');
const output = path.join(project, 'dist');
const extensionOutput = path.join(output, 'extection');

rmSync(output, { recursive: true, force: true });
mkdirSync(extensionOutput, { recursive: true });

for (const file of readdirSync(extension)) {
  if (!file.endsWith('.ts')) copyFileSync(path.join(extension, file), path.join(extensionOutput, file));
}

buildSync({
  entryPoints: ['content', 'background', 'options'].map(name => path.join(extension, `${name}.ts`)),
  outdir: extensionOutput, bundle: true, platform: 'browser', format: 'iife', target: 'chrome120',
});

buildSync({
  entryPoints: ['dom', 'controller', 'background', 'panel'].map(name => path.join(extension, `${name}.ts`))
    .concat(path.join(project, 'shared', 'settings.ts')),
  outdir: path.join(output, 'test'), entryNames: '[name]', bundle: true, platform: 'node', format: 'cjs',
});

buildSync({
  entryPoints: ['index', 'http', 'analyze', 'adapters'].map(name => path.join(project, 'backend', `${name}.ts`)),
  outdir: path.join(output, 'backend'), bundle: true, platform: 'node', format: 'cjs',
});

process.stdout.write(`Extension ready: ${extensionOutput}\n`);

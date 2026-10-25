import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const source = join(process.cwd(), 'node_modules', 'stockfish');
const target = join(process.cwd(), 'public', 'stockfish');
mkdirSync(target, { recursive: true });
for (const name of readdirSync(target)) {
  rmSync(join(target, name));
}
for (const name of [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
  'stockfish-19-single.js',
  'stockfish-19-single.wasm'
]) {
  copyFileSync(join(source, 'bin', name), join(target, name));
}
copyFileSync(join(source, 'Copying.txt'), join(target, 'Copying.txt'));

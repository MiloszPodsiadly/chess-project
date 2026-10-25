import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'stockfish', 'package.json')));
if (pkg.version !== '19.0.1') throw new Error(`Unexpected Stockfish.js ${pkg.version}`);
for (const name of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm',
  'stockfish-19-single.js', 'stockfish-19-single.wasm']) {
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const source = join(root, 'node_modules', 'stockfish', 'bin', name);
  const target = join(root, 'public', 'stockfish', name);
  if (hash(source) !== hash(target)) throw new Error(`Asset mismatch: ${name}`);
  if (!statSync(target).size) throw new Error(`Empty asset: ${name}`);
}

const executable = join(root, 'public', 'stockfish', 'stockfish-19-lite-single.js');
const child = spawn(process.execPath, [executable], { stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
let readySent = false;
let searchSent = false;
const timeout = setTimeout(() => child.kill(), 15000);
child.stdout.on('data', chunk => {
  output += chunk.toString();
  if (output.includes('uciok') && !readySent) {
    readySent = true;
    child.stdin.write('isready\n');
  }
  if (output.includes('readyok') && !searchSent) {
    searchSent = true;
    child.stdin.write('position startpos\ngo depth 1\n');
  }
  if (output.includes('bestmove')) {
    clearTimeout(timeout);
    if (!output.includes('Stockfish 19') || !/bestmove [a-h][1-8][a-h][1-8]/.test(output)) {
      throw new Error('Unexpected UCI handshake or move');
    }
    console.log('PASS Stockfish.js 19 assets and UCI search');
    child.kill();
  }
});
child.on('exit', code => {
  clearTimeout(timeout);
  if (!output.includes('bestmove')) process.exitCode = code || 1;
});
child.stdin.write('uci\n');

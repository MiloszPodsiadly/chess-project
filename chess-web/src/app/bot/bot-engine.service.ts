import { Injectable } from '@angular/core';
import { Chess } from 'chess.js';
import { EngineConfigMapper } from './engine-config-mapper';
import { BotMoveStrategy, CandidateMove } from './bot-move-strategy';

@Injectable({ providedIn: 'root' })
export class BotEngineService {
  private worker = new Worker('/stockfish/stockfish.js');
  private analysisId = 0;
  private resolver: ((move: string) => void) | null = null;
  private lastFen: string | null = null;
  private candidates: Map<number, CandidateMove> = new Map();
  private currentProfile = EngineConfigMapper.forElo(1200);

  constructor() {
    this.worker.onmessage = (event: MessageEvent<string>) => this.handleMessage(String(event.data ?? ''));
    this.worker.postMessage('uci');
    this.worker.postMessage('isready');
  }

  async getMove(fen: string, elo: number): Promise<string> {
    const profile = EngineConfigMapper.forElo(elo);
    this.currentProfile = profile;
    this.lastFen = fen;

    if (profile.moveSelection === 'RANDOM_LEGAL') {
      const chess = new Chess(fen);
      const moves = chess.moves({ verbose: true });
      const random = moves[Math.floor(Math.random() * moves.length)];
      return `${random.from}${random.to}${random.promotion ?? ''}`;
    }

    this.analysisId += 1;
    const localId = this.analysisId;
    this.candidates.clear();

    const movetime = EngineConfigMapper.pickTime(profile);
    const depth = profile.depthCap;
    const multipv = Math.max(1, profile.topMoves);

    this.worker.postMessage('stop');
    this.worker.postMessage(`setoption name MultiPV value ${multipv}`);
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth} movetime ${movetime}`);

    return new Promise((resolve) => {
      this.resolver = (move) => {
        if (localId !== this.analysisId) {
          return;
        }
        resolve(move);
      };
    });
  }

  private handleMessage(line: string) {
    if (line.startsWith('info')) {
      this.captureInfo(line);
      return;
    }
    if (line.startsWith('bestmove') && this.resolver) {
      const chosen = BotMoveStrategy.chooseMove([...this.candidates.values()], this.currentProfile, this.lastFen);
      const move = chosen?.move ?? line.split(' ')[1] ?? '';
      const resolve = this.resolver;
      this.resolver = null;
      resolve(move);
    }
  }

  private captureInfo(line: string) {
    if (!line.includes(' pv ')) {
      return;
    }
    const tokens = line.split(' ');
    const pvIdx = tokens.indexOf('pv');
    const scoreIdx = tokens.indexOf('score');
    const multiPvIdx = tokens.indexOf('multipv');
    if (pvIdx === -1 || scoreIdx === -1) {
      return;
    }
    const move = tokens[pvIdx + 1];
    if (!move) {
      return;
    }
    const multipv = multiPvIdx !== -1 ? Number(tokens[multiPvIdx + 1]) : 1;
    let score = 0;
    if (tokens[scoreIdx + 1] === 'cp') {
      score = Number(tokens[scoreIdx + 2]);
    } else if (tokens[scoreIdx + 1] === 'mate') {
      const mate = Number(tokens[scoreIdx + 2]);
      score = mate > 0 ? 100000 - mate : -100000 - mate;
    }
    this.candidates.set(multipv, { move, score });
  }
}

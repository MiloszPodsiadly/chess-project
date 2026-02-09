import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Chess } from 'chess.js';
import { EngineMoveResponseDto } from '../multiplayer/models';

export interface AnalysisLine {
  move: string;
  score: string;
  pv: string;
  pvSan: string;
}

@Injectable({ providedIn: 'root' })
export class EngineAnalysisService {
  private worker: Worker;
  private lines: AnalysisLine[] = [];
  private pendingTimer: number | null = null;
  private lastFen: string | null = null;

  readonly evaluation$ = new BehaviorSubject<string>('0.0');
  readonly lines$ = new BehaviorSubject<AnalysisLine[]>([]);
  readonly bestMove$ = new BehaviorSubject<string | null>(null);
  readonly bestMoveSan$ = new BehaviorSubject<string | null>(null);
  readonly enabled$ = new BehaviorSubject<boolean>(true);
  readonly external$ = new BehaviorSubject<boolean>(false);
  readonly depth$ = new BehaviorSubject<number | null>(null);
  readonly nodes$ = new BehaviorSubject<number | null>(null);
  readonly nps$ = new BehaviorSubject<number | null>(null);

  constructor() {
    this.worker = new Worker('/stockfish/stockfish.js');
    this.worker.onmessage = (event: MessageEvent<string>) => {
      this.handleWorkerMessage(String(event.data ?? ''));
    };
    this.worker.postMessage('uci');
    this.worker.postMessage('isready');
  }

  analyze(fen: string, depth = 12, movetime = 250) {
    if (!this.enabled$.value) {
      return;
    }
    if (this.external$.value) {
      return;
    }
    this.lastFen = fen;
    this.lines = [];
    this.lines$.next([]);
    this.depth$.next(null);
    this.nodes$.next(null);
    this.nps$.next(null);
    this.worker.postMessage('stop');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth} movetime ${movetime}`);
  }

  scheduleAnalyze(fen: string, depth = 12, movetime = 250, delayMs = 200) {
    if (!this.enabled$.value) {
      return;
    }
    if (this.external$.value) {
      return;
    }
    if (this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      this.analyze(fen, depth, movetime);
    }, delayMs);
  }

  stop() {
    this.worker.postMessage('stop');
  }

  toggleHints() {
    const next = !this.enabled$.value;
    this.enabled$.next(next);
    if (!next) {
      this.stop();
    }
  }

  applyExternalAnalysis(analysis: EngineMoveResponseDto | null) {
    if (!analysis) {
      return;
    }
    this.external$.next(true);
    const evalValue = analysis.evaluation ? this.formatEval(analysis.evaluation.type, analysis.evaluation.value) : '0.0';
    this.evaluation$.next(evalValue);
    this.bestMove$.next(this.toUci(analysis.bestMove));
    const topSan = analysis.topLines?.[0]?.san;
    this.bestMoveSan$.next(topSan ?? this.toUci(analysis.bestMove));
    const mapped = analysis.topLines.map((line) => ({
      move: line.san ?? this.toUci(line.move) ?? '',
      score: line.evaluation ? this.formatEval(line.evaluation.type, line.evaluation.value) : '',
      pv: line.principalVariation.map((m) => this.toUci(m)).filter(Boolean).join(' '),
      pvSan: (line.principalVariationSan ?? []).join(' ')
    }));
    this.lines = mapped.slice(0, 5);
    this.lines$.next([...this.lines]);
  }

  useLocalAnalysis() {
    this.external$.next(false);
  }

  private handleWorkerMessage(line: string) {
    if (line.startsWith('info')) {
      this.handleInfo(line);
    }
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const uci = parts[1] ?? null;
      this.bestMove$.next(uci);
      this.bestMoveSan$.next(this.uciToSan(uci));
    }
  }

  private handleInfo(line: string) {
    if (!line.includes(' pv ')) {
      return;
    }
    const tokens = line.split(' ');
    const depthIdx = tokens.indexOf('depth');
    const scoreIdx = tokens.indexOf('score');
    const pvIdx = tokens.indexOf('pv');
    const multiPvIdx = tokens.indexOf('multipv');
    const nodesIdx = tokens.indexOf('nodes');
    const npsIdx = tokens.indexOf('nps');
    if (scoreIdx === -1 || pvIdx === -1) {
      return;
    }
    if (depthIdx !== -1) {
      const depthValue = Number(tokens[depthIdx + 1]);
      if (!Number.isNaN(depthValue)) {
        this.depth$.next(depthValue);
      }
    }
    if (nodesIdx !== -1) {
      const nodesValue = Number(tokens[nodesIdx + 1]);
      if (!Number.isNaN(nodesValue)) {
        this.nodes$.next(nodesValue);
      }
    }
    if (npsIdx !== -1) {
      const npsValue = Number(tokens[npsIdx + 1]);
      if (!Number.isNaN(npsValue)) {
        this.nps$.next(npsValue);
      }
    }
    let score = '';
    if (tokens[scoreIdx + 1] === 'cp') {
      score = (Number(tokens[scoreIdx + 2]) / 100).toFixed(2);
    } else if (tokens[scoreIdx + 1] === 'mate') {
      const mateValue = tokens[scoreIdx + 2];
      score = `M${mateValue}`;
    }
    const pvMoves = tokens.slice(pvIdx + 1, pvIdx + 6);
    const pv = pvMoves.join(' ');
    const move = pvMoves[0] ?? '';
    const pvIndex = multiPvIdx !== -1 ? Number(tokens[multiPvIdx + 1]) : 1;
    if (!move) {
      return;
    }
    const entry = { move, score, pv, pvSan: this.toSanLine(pvMoves) };
    this.lines[pvIndex - 1] = entry;
    this.lines = this.lines.filter(Boolean).slice(0, 5);
    this.lines$.next([...this.lines]);
    if (depthIdx !== -1) {
      this.evaluation$.next(score || this.evaluation$.value);
    }
  }

  private toSanLine(pvMoves: string[]) {
    if (!this.lastFen) {
      return pvMoves.join(' ');
    }
    try {
      const chess = new Chess(this.lastFen);
      const sanMoves: string[] = [];
      for (const move of pvMoves) {
        if (move.length < 4) {
          break;
        }
        const from = move.slice(0, 2);
        const to = move.slice(2, 4);
        const promotion = move.length > 4 ? move[4] : undefined;
        const result = chess.move({ from, to, promotion: promotion as any });
        if (!result) {
          break;
        }
        sanMoves.push(result.san);
      }
      return sanMoves.join(' ');
    } catch {
      return pvMoves.join(' ');
    }
  }

  private formatEval(type: 'CP' | 'MATE', value: number) {
    if (type === 'MATE') {
      return `M${value}`;
    }
    return (value / 100).toFixed(2);
  }

  private uciToSan(uci: string | null) {
    if (!uci || uci.length < 4 || !this.lastFen) {
      return uci;
    }
    try {
      const chess = new Chess(this.lastFen);
      const move = chess.move({
        from: uci.slice(0, 2) as any,
        to: uci.slice(2, 4) as any,
        promotion: uci.length > 4 ? (uci[4] as any) : undefined
      });
      return move?.san ?? uci;
    } catch {
      return uci;
    }
  }

  private toUci(move: { from: string; to: string; promotion?: string | null } | null) {
    if (!move) {
      return null;
    }
    return `${move.from}${move.to}${move.promotion ?? ''}`;
  }
}

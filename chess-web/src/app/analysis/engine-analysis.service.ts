import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Chess } from 'chess.js';
import { EngineMoveResponseDto } from '../multiplayer/models';
import { BrowserUciEngine, BrowserEngineFlavor } from './browser-uci-engine';

export interface AnalysisLine {
  move: string;
  score: string;
  pv: string;
  pvSan: string;
}

@Injectable({ providedIn: 'root' })
export class EngineAnalysisService {
  private readonly engine = new BrowserUciEngine();
  private lines: AnalysisLine[] = [];
  private linesByPv = new Map<number, AnalysisLine>();
  private latestDepth = 0;
  private pendingTimer: number | null = null;
  private lastFen: string | null = null;
  private requestId = 0;
  private flavor: BrowserEngineFlavor = 'lite';
  readonly status$ = new BehaviorSubject<string>('idle');

  readonly evaluation$ = new BehaviorSubject<string>('—');
  readonly completedEvaluation$ = new BehaviorSubject<{ fen: string; value: string } | null>(null);
  readonly lines$ = new BehaviorSubject<AnalysisLine[]>([]);
  readonly bestMove$ = new BehaviorSubject<string | null>(null);
  readonly bestMoveSan$ = new BehaviorSubject<string | null>(null);
  readonly enabled$ = new BehaviorSubject<boolean>(true);
  readonly external$ = new BehaviorSubject<boolean>(false);
  readonly depth$ = new BehaviorSubject<number | null>(null);
  readonly nodes$ = new BehaviorSubject<number | null>(null);
  readonly nps$ = new BehaviorSubject<number | null>(null);
  readonly timeMillis$ = new BehaviorSubject<number | null>(null);

  setFlavor(flavor: BrowserEngineFlavor) {
    this.flavor = flavor;
    this.stop();
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
    this.linesByPv.clear();
    this.latestDepth = 0;
    this.lines$.next([]);
    this.evaluation$.next('—');
    this.bestMove$.next(null);
    this.bestMoveSan$.next(null);
    this.depth$.next(null);
    this.nodes$.next(null);
    this.nps$.next(null);
    this.timeMillis$.next(null);
    const requestId = ++this.requestId;
    this.status$.next('loading');
    void this.engine.search(fen, { depth, movetime, multiPv: 5, flavor: this.flavor },
      line => { if (requestId === this.requestId) this.handleInfo(line); })
      .then(move => {
        if (requestId !== this.requestId) return;
        this.bestMove$.next(move);
        this.bestMoveSan$.next(this.uciToSan(move));
        if (this.evaluation$.value !== '—') {
          this.completedEvaluation$.next({ fen, value: this.evaluation$.value });
        }
        this.status$.next('ready');
      })
      .catch(error => {
        if (requestId === this.requestId) this.status$.next(error.message);
      });
  }

  scheduleAnalyze(fen: string, depth = 12, movetime = 250, delayMs = 200) {
    if (!this.enabled$.value) {
      return;
    }
    if (this.external$.value) {
      return;
    }
    if (this.lastFen !== fen) this.stop();
    if (this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      this.analyze(fen, depth, movetime);
    }, delayMs);
  }

  stop() {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.requestId++;
    this.engine.stop();
    this.status$.next('idle');
    this.evaluation$.next('—');
    this.bestMove$.next(null);
    this.bestMoveSan$.next(null);
    this.lines$.next([]);
  }

  toggleHints() {
    const next = !this.enabled$.value;
    this.enabled$.next(next);
    if (!next) {
      this.stop();
    }
  }

  applyExternalAnalysis(analysis: EngineMoveResponseDto | null, fen?: string) {
    if (!analysis) {
      return;
    }
    this.stop();
    this.external$.next(true);
    const evalValue = analysis.evaluation ? this.formatEval(analysis.evaluation.type,
      analysis.evaluation.value, analysis.evaluation.side) : '—';
    this.evaluation$.next(evalValue);
    if (fen && evalValue !== '—') this.completedEvaluation$.next({ fen, value: evalValue });
    this.bestMove$.next(this.toUci(analysis.bestMove));
    const topSan = analysis.topLines?.[0]?.san;
    this.bestMoveSan$.next(topSan ?? this.toUci(analysis.bestMove));
    const mapped = analysis.topLines.map((line) => ({
      move: line.san ?? this.toUci(line.move) ?? '',
      score: line.evaluation ? this.formatEval(line.evaluation.type,
        line.evaluation.value, line.evaluation.side) : '',
      pv: line.principalVariation.map((m) => this.toUci(m)).filter(Boolean).join(' '),
      pvSan: (line.principalVariationSan ?? []).join(' ')
    }));
    this.lines = mapped.slice(0, 5);
    this.lines$.next([...this.lines]);
    this.depth$.next(analysis.depth);
    this.nodes$.next(analysis.nodes);
    this.timeMillis$.next(analysis.timeMillis);
    this.nps$.next(analysis.timeMillis > 0
      ? Math.round(analysis.nodes * 1000 / analysis.timeMillis) : null);
  }

  useLocalAnalysis() {
    this.stop();
    this.external$.next(false);
    this.evaluation$.next('—');
    this.bestMove$.next(null);
    this.bestMoveSan$.next(null);
    this.lines$.next([]);
    this.depth$.next(null);
    this.nodes$.next(null);
    this.nps$.next(null);
    this.timeMillis$.next(null);
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
    const timeIdx = tokens.indexOf('time');
    if (scoreIdx === -1 || pvIdx === -1) {
      return;
    }
    if (tokens.includes('lowerbound') || tokens.includes('upperbound')) return;
    const depthValue = depthIdx === -1 ? 0 : Number(tokens[depthIdx + 1]);
    if (!Number.isFinite(depthValue) || depthValue < this.latestDepth) return;
    if (depthValue > this.latestDepth) {
      this.latestDepth = depthValue;
      this.linesByPv.clear();
      this.depth$.next(depthValue);
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
    if (timeIdx !== -1) {
      const timeValue = Number(tokens[timeIdx + 1]);
      if (!Number.isNaN(timeValue)) this.timeMillis$.next(timeValue);
    }
    let score = '';
    if (tokens[scoreIdx + 1] === 'cp') {
      const sign = this.lastFen?.split(' ')[1] === 'b' ? -1 : 1;
      score = (sign * Number(tokens[scoreIdx + 2]) / 100).toFixed(2);
    } else if (tokens[scoreIdx + 1] === 'mate') {
      const mateValue = tokens[scoreIdx + 2];
      const sign = this.lastFen?.split(' ')[1] === 'b' ? -1 : 1;
      score = `M${sign * Number(mateValue)}`;
    }
    const pvMoves = tokens.slice(pvIdx + 1, pvIdx + 6);
    const pv = pvMoves.join(' ');
    const move = pvMoves[0] ?? '';
    const pvIndex = multiPvIdx !== -1 ? Number(tokens[multiPvIdx + 1]) : 1;
    if (!move) {
      return;
    }
    const entry = { move, score, pv, pvSan: this.toSanLine(pvMoves) };
    this.linesByPv.set(pvIndex, entry);
    this.lines = [...this.linesByPv.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line).slice(0, 5);
    this.lines$.next([...this.lines]);
    if (pvIndex === 1) {
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

  private formatEval(type: 'CP' | 'MATE', value: number, side: 'WHITE' | 'BLACK') {
    const whiteValue = side === 'BLACK' ? -value : value;
    if (type === 'MATE') {
      return `M${whiteValue}`;
    }
    return (whiteValue / 100).toFixed(2);
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

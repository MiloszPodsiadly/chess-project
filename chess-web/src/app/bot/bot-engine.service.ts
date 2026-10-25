import { Injectable, OnDestroy } from '@angular/core';
import { BrowserUciEngine, BrowserEngineFlavor } from '../analysis/browser-uci-engine';

@Injectable({ providedIn: 'root' })
export class BotEngineService implements OnDestroy {
  private engine = new BrowserUciEngine();
  supportsNativeElo(): boolean { return this.engine.supportsNativeElo(); }

  private reusableEngine(): BrowserUciEngine {
    if (this.engine.state === 'DISPOSED') this.engine = new BrowserUciEngine();
    return this.engine;
  }

  static effectiveSearch(elo: number | null, flavor: BrowserEngineFlavor, maximumMs = 300) {
    if (elo !== null && (!Number.isInteger(elo) || elo < 200 || elo > 3190)) {
      throw new RangeError('Browser strength target must be 200–3190');
    }
    if (!Number.isInteger(maximumMs) || maximumMs < 1 || maximumMs > 10000) {
      throw new RangeError('Browser search budget must be 1–10000 ms');
    }
    return { depth: 30, movetime: elo === null ? maximumMs
      : flavor === 'full' ? 300 : elo < 1000 ? 80 : elo < 1800 ? 120 : 200 };
  }

  warm(flavor: BrowserEngineFlavor = 'lite'): Promise<void> {
    return this.reusableEngine().warm(flavor);
  }

  getMove(fen: string, elo: number | null, flavor: BrowserEngineFlavor = 'lite', maximumMs = 300): Promise<string> {
    const { depth, movetime } = BotEngineService.effectiveSearch(elo, flavor, maximumMs);
    return this.reusableEngine().search(fen, {
      depth,
      movetime,
      multiPv: 1,
      target: elo ?? undefined,
      gameplay: true,
      flavor
    });
  }

  stop(): void {
    this.engine.stop();
  }

  dispose(): void {
    this.engine.dispose();
  }

  ngOnDestroy(): void { this.dispose(); }
}

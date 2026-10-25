import { Injectable } from '@angular/core';
import { BrowserUciEngine } from '../analysis/browser-uci-engine';
import { EngineConfigMapper } from './engine-config-mapper';

@Injectable({ providedIn: 'root' })
export class BotEngineService {
  private readonly engine = new BrowserUciEngine();

  getMove(fen: string, elo: number): Promise<string> {
    const profile = EngineConfigMapper.forElo(elo);
    return this.engine.search(fen, {
      depth: profile.depthCap,
      movetime: EngineConfigMapper.pickTime(profile),
      multiPv: 1
    });
  }

  stop(): void {
    this.engine.stop();
  }
}

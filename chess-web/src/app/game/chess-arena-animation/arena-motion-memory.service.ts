import { Injectable } from '@angular/core';

/** Session-scoped choreography memory survives route/component recreation. */
@Injectable({ providedIn: 'root' })
export class ArenaMotionMemory {
  private introSeen = false;
  private readonly matches = new Set<string>();

  claimIntro(): boolean {
    if (this.introSeen) return false;
    this.introSeen = true;
    return true;
  }

  claimMatch(id: string): boolean {
    if (this.matches.has(id)) return false;
    if (this.matches.size >= 32) this.matches.delete(this.matches.values().next().value!);
    this.matches.add(id);
    return true;
  }
}

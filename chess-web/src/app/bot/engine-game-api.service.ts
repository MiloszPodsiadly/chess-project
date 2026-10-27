import { Injectable } from '@angular/core';
import { EngineMoveResponseDto } from '../multiplayer/models';

export type ServerEngineMode = 'BEGINNER' | 'TRAINING' | 'FULL_STRENGTH';
export type StrengthPreset = 'STRONG' | 'EXPERT' | 'ULTIMATE' | 'DEEP_CHALLENGE';
export class EngineSessionExpiredError extends Error {}

export interface ServerEngineGame {
  gameId: string;
  fen: string;
  sideToMove: 'WHITE' | 'BLACK';
  result: 'ONGOING' | 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW';
  endReason: string;
  moves: { from: string; to: string; promotion?: string | null }[];
  turnState: 'PLAYER_TURN' | 'ENGINE_THINKING' | 'ENGINE_FAILED' | 'FINISHED';
  version: number;
  engineError?: string | null;
  engineMode?: ServerEngineMode | null;
  enginePreset?: StrengthPreset | null;
  engineElo?: number | null;
  engineTimeBudgetMs?: number | null;
  analysis?: EngineMoveResponseDto | null;
  playerColor: 'WHITE' | 'BLACK';
  engineExecutionId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EngineGameApiService {
  private sessionVerified = false;
  get authenticated(): boolean {
    return this.sessionVerified && !!this.token;
  }

  private get token(): string | null {
    try { return sessionStorage.getItem('chessEngineToken'); } catch { return null; }
  }

  async authenticate(username: string, password: string, email?: string): Promise<void> {
    const register = !!email;
    const response = await fetch(`/api/auth/${register ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(register
        ? { username, email, password }
        : { usernameOrEmail: username, password })
    });
    if (!response.ok) throw new Error(`Sign in failed (${response.status})`);
    const data = await response.json() as { accessToken: string };
    if (!data.accessToken) throw new Error('Server returned no access token');
    sessionStorage.setItem('chessEngineToken', data.accessToken);
    this.sessionVerified = true;
  }

  async validateSession(): Promise<boolean> {
    const token = this.token;
    if (!token) { this.sessionVerified = false; return false; }
    try {
      const response = await fetch('/api/auth/api-session', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (token !== this.token) return this.authenticated;
      if (response.status === 401 || response.status === 403) {
        this.clearSession();
        return false;
      }
      this.sessionVerified = response.ok;
      return this.sessionVerified;
    } catch {
      this.sessionVerified = false;
      return false;
    }
  }

  private clearSession(): void {
    this.sessionVerified = false;
    try { sessionStorage.removeItem('chessEngineToken'); } catch { /* Private browsing. */ }
  }

  async create(playerColor: 'w' | 'b', elo: number, mode: ServerEngineMode,
               preset: StrengthPreset): Promise<ServerEngineGame> {
    const params = new URLSearchParams({
      playerColor: playerColor === 'w' ? 'WHITE' : 'BLACK',
      engineElo: String(elo), mode, preset, timeControlType: 'UNTIMED'
    });
    return this.request(`/api/engine-games?${params}`, 'POST');
  }

  move(id: string, version: number, move: { from: string; to: string; promotion?: string }): Promise<ServerEngineGame> {
    return this.request(`/api/engine-games/${id}/move?expectedVersion=${version}`, 'POST', move);
  }

  get(id: string): Promise<ServerEngineGame> {
    return this.request(`/api/engine-games/${id}`, 'GET');
  }

  retry(id: string): Promise<ServerEngineGame> {
    return this.request(`/api/engine-games/${id}/retry`, 'POST');
  }

  restart(id: string): Promise<ServerEngineGame> {
    return this.request(`/api/engine-games/${id}/restart`, 'POST');
  }

  resign(id: string): Promise<ServerEngineGame> {
    return this.request(`/api/engine-games/${id}/resign`, 'POST');
  }

  private async request(path: string, method: string, body?: unknown): Promise<ServerEngineGame> {
    const token = this.token;
    if (!token) throw new Error('Sign in to play against server Stockfish');
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.clearSession();
        throw new EngineSessionExpiredError('Your server session expired. Sign in again.');
      }
      let message = `Engine request failed (${response.status})`;
      try {
        const error = await response.json() as { message?: string; error?: string };
        message = error.message ?? error.error ?? message;
      } catch { /* HTTP error without a JSON body. */ }
      throw new Error(message);
    }
    return response.json() as Promise<ServerEngineGame>;
  }
}

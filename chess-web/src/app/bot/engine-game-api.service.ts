import { Injectable } from '@angular/core';

export type ServerEngineMode = 'BEGINNER' | 'TRAINING' | 'FULL_STRENGTH';
export type StrengthPreset = 'STRONG' | 'EXPERT' | 'ULTIMATE' | 'DEEP_CHALLENGE';

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
}

@Injectable({ providedIn: 'root' })
export class EngineGameApiService {
  get authenticated(): boolean {
    return !!this.token;
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
      let message = `Engine request failed (${response.status})`;
      try {
        const error = await response.json() as { message?: string };
        message = error.message ?? message;
      } catch { /* HTTP error without a JSON body. */ }
      throw new Error(message);
    }
    return response.json() as Promise<ServerEngineGame>;
  }
}

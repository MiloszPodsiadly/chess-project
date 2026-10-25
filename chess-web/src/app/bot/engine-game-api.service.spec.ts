import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineGameApiService } from './engine-game-api.service';

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('EngineGameApiService session state', () => {
  it('does not treat a saved token as a verified session and removes an expired token', async () => {
    sessionStorage.setItem('chessEngineToken', 'expired');
    const api = new EngineGameApiService();
    expect(api.authenticated).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    expect(await api.validateSession()).toBe(false);
    expect(sessionStorage.getItem('chessEngineToken')).toBeNull();
  });

  it('marks a successful login as verified', async () => {
    const api = new EngineGameApiService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ accessToken: 'valid' }) }));
    await api.authenticate('player', 'secret');
    expect(api.authenticated).toBe(true);
  });
});

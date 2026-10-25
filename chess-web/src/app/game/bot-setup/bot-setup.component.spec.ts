import { describe, expect, it, vi } from 'vitest';
import { BotSetupComponent } from './bot-setup.component';
import { EngineGameApiService } from '../../bot/engine-game-api.service';

describe('BotSetupComponent', () => {
  it('rejects empty, fractional and out-of-range targets without clamping', () => {
    const setup = new BotSetupComponent({ authenticated: false } as EngineGameApiService);
    const targets: number[] = [];
    setup.strengthChange.subscribe(value => targets.push(value!));
    setup.customValue('');
    expect(Number.isNaN(targets.at(-1))).toBe(true);
    setup.elo = NaN;
    expect(setup.valid).toBe(false);
    setup.customValue('1320.5');
    setup.elo = targets.at(-1)!;
    expect(setup.valid).toBe(false);
    setup.customValue('3190');
    setup.elo = targets.at(-1)!;
    expect(setup.valid).toBe(true);
  });

  it('closes authentication and clears errors after success', async () => {
    const api = { authenticate: vi.fn().mockResolvedValue(undefined), authenticated: true } as unknown as EngineGameApiService;
    const setup = new BotSetupComponent(api);
    setup.authOpen = true;
    setup.username = 'user'; setup.password = 'pass'; setup.authError = 'stale';
    await setup.authenticate();
    expect(setup.authOpen).toBe(false);
    expect(setup.authError).toBe('');
    expect(setup.password).toBe('');
  });

  it('passes registration email only in registration mode', async () => {
    const api = { authenticate: vi.fn().mockResolvedValue(undefined), authenticated: true } as unknown as EngineGameApiService;
    const setup = new BotSetupComponent(api);
    setup.authMode = 'register'; setup.username = 'user'; setup.email = 'user@example.com'; setup.password = 'pass';
    await setup.authenticate();
    expect(api.authenticate).toHaveBeenCalledWith('user', 'pass', 'user@example.com');
  });
});

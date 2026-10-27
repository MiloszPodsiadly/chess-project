import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { MultiplayerRedirectComponent } from './multiplayer-redirect.component';

describe('MultiplayerRedirectComponent', () => {
  it('redirects deep links to the canonical online lobby and strips credential query params', () => {
    const route = {
      snapshot: {
        queryParams: {
          roomCode: 'ABC123',
          source: 'invite',
          reconnectToken: 'must-not-leak',
          roomReconnectToken: 'must-not-leak-either',
          room_reconnect_token: 'also-must-not-leak',
          token: 'also-sensitive'
        }
      }
    } as unknown as ActivatedRoute;
    const router = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;

    new MultiplayerRedirectComponent(route, router).ngOnInit();

    expect(router.navigate).toHaveBeenCalledWith(['/game'], {
      queryParams: { roomCode: 'ABC123', source: 'invite', mode: 'online' },
      replaceUrl: true
    });
  });
});

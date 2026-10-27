import { GamePageComponent } from './game/game.page';
import { MultiplayerRedirectComponent } from './multiplayer/multiplayer-redirect.component';
import { routes } from './app.routes';

describe('app routes', () => {
  it('keeps the online game as the canonical multiplayer destination', async () => {
    const gameRoute = routes.find((route) => route.path === 'game');
    const multiplayerRoute = routes.find((route) => route.path === 'multiplayer');

    expect(await gameRoute?.loadComponent?.()).toBe(GamePageComponent);
    expect(multiplayerRoute?.component).toBe(MultiplayerRedirectComponent);
    expect(multiplayerRoute?.pathMatch).toBe('full');
  });
});

import { GamePageComponent } from './game/game.page';
import { MultiplayerPageComponent } from './multiplayer/multiplayer.page';
import { routes } from './app.routes';

describe('app routes', () => {
  it('resolves the game and multiplayer pages through their lazy route loaders', async () => {
    const gameRoute = routes.find((route) => route.path === 'game');
    const multiplayerRoute = routes.find((route) => route.path === 'multiplayer');

    expect(await gameRoute?.loadComponent?.()).toBe(GamePageComponent);
    expect(await multiplayerRoute?.loadComponent?.()).toBe(MultiplayerPageComponent);
  });
});

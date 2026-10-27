import { Routes } from '@angular/router';
import { HomePageComponent } from './home/home.page';
import { MultiplayerRedirectComponent } from './multiplayer/multiplayer-redirect.component';

export const routes: Routes = [
  { path: '', component: HomePageComponent },
  {
    path: 'game',
    loadComponent: () => import('./game/game.page').then((module) => module.GamePageComponent)
  },
  {
    path: 'multiplayer',
    component: MultiplayerRedirectComponent,
    pathMatch: 'full'
  }
];

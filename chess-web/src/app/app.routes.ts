import { Routes } from '@angular/router';
import { HomePageComponent } from './home/home.page';

export const routes: Routes = [
  { path: '', component: HomePageComponent },
  {
    path: 'game',
    loadComponent: () => import('./game/game.page').then((module) => module.GamePageComponent)
  },
  {
    path: 'multiplayer',
    loadComponent: () => import('./multiplayer/multiplayer.page').then((module) => module.MultiplayerPageComponent)
  }
];

import { Routes } from '@angular/router';
import { MultiplayerPageComponent } from './multiplayer/multiplayer.page';
import { GamePageComponent } from './game/game.page';
import { HomePageComponent } from './home/home.page';

export const routes: Routes = [
  { path: '', component: HomePageComponent },
  { path: 'game', component: GamePageComponent },
  { path: 'multiplayer', component: MultiplayerPageComponent }
];

import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ChessArenaAnimationComponent } from '../game/chess-arena-animation/chess-arena-animation.component';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [RouterModule, ChessArenaAnimationComponent],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css'
})
export class HomePageComponent {
  lang: 'en' | 'pl' = 'en';

  readonly translations = {
    en: {
      tagline: 'Play. Analyze. Improve.',
      playBot: 'Play vs Bot',
      playOnline: 'Play Online',
      botDesc: 'Set the engine strength',
      onlineDesc: 'Matchmaking, rooms, reconnect',
      primaryNavigation: 'Primary navigation',
      homeLink: 'Chess Arena home',
      gameModes: 'Game modes',
      menuTitle: 'Choose a mode',
      tipsTitle: 'A good place to start',
      sidebarNote: 'A focused space for your next game.',
      tip1: 'Analyze positions while you play',
      tip2: 'Join matchmaking or create a room',
      heroKicker: 'YOUR NEXT GAME',
      heroTitle: 'Play with purpose.',
      heroCopy:
        'Train against Stockfish 19, study positions with built-in analysis, or find an opponent in online matchmaking.',
      langLabel: 'Language',
      welcomeSection: 'Choose how to play',
      arenaLabel: 'Chess Arena illustration'
    },
    pl: {
      tagline: 'Graj. Analizuj. Rozwijaj się.',
      playBot: 'Graj z botem',
      playOnline: 'Graj online',
      botDesc: 'Dopasuj siłę silnika',
      onlineDesc: 'Matchmaking, pokoje, powrót do gry',
      primaryNavigation: 'Nawigacja główna',
      homeLink: 'Strona główna Chess Arena',
      gameModes: 'Tryby gry',
      menuTitle: 'Wybierz tryb',
      tipsTitle: 'Na dobry początek',
      sidebarNote: 'Skup się na kolejnej partii.',
      tip1: 'Analizuj pozycje w trakcie gry',
      tip2: 'Dołącz do matchmakingu lub utwórz pokój',
      heroKicker: 'TWOJA NASTĘPNA PARTIA',
      heroTitle: 'Graj z pomysłem.',
      heroCopy:
        'Trenuj ze Stockfishem 19, analizuj pozycje w trakcie partii lub znajdź przeciwnika w trybie online.',
      langLabel: 'Język',
      welcomeSection: 'Wybierz sposób gry',
      arenaLabel: 'Ilustracja Chess Arena'
    }
  } as const;

  constructor() {
    const saved = this.safeLocalGet('lang');
    if (saved === 'pl' || saved === 'en') {
      this.lang = saved;
    }
  }

  setLang(lang: 'en' | 'pl') {
    this.lang = lang;
    this.safeLocalSet('lang', lang);
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'lang', newValue: lang }));
    } catch {
    }
  }

  t(key: keyof typeof this.translations.en) {
    return this.translations[this.lang][key];
  }

  private safeLocalGet(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private safeLocalSet(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
    }
  }
}

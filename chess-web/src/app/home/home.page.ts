import { Component } from '@angular/core';
import { NgForOf } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [RouterModule, NgForOf],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css'
})
export class HomePageComponent {
  lang: 'en' | 'pl' = 'en';

  readonly translations = {
    en: {
      name: 'Chess Arena',
      tagline: 'Play. Analyze. Improve.',
      playBot: 'Play vs Bot',
      playOnline: 'Play Online',
      botDesc: 'Train with adjustable Elo',
      onlineDesc: 'Lobby, matchmaking, reconnect',
      tipsTitle: 'Quick tips',
      tip1: 'Use bot mode to test openings',
      tip2: 'Multiplayer supports reconnect',
      tip3: 'Analysis panel shows PV lines',
      heroTitle: 'Play chess like a pro',
      heroCopy:
        'Choose a mode, set your pace, and analyze every move with real-time evaluation. Built for competitive play.',
      langLabel: 'Language'
    },
    pl: {
      name: 'Arena Szachowa',
      tagline: 'Graj. Analizuj. Poprawiaj.',
      playBot: 'Graj z botem',
      playOnline: 'Graj online',
      botDesc: 'Trening z regulowanym Elo',
      onlineDesc: 'Lobby, matchmaking, powrot',
      tipsTitle: 'Szybkie wskazowki',
      tip1: 'Uzyj bota, by testowac debiuty',
      tip2: 'Multiplayer wspiera ponowne polaczenie',
      tip3: 'Panel analizy pokazuje linie PV',
      heroTitle: 'Graj w szachy jak zawodowiec',
      heroCopy:
        'Wybierz tryb, ustaw tempo i analizuj kazdy ruch w czasie rzeczywistym. Stworzone do gry turniejowej.',
      langLabel: 'Jezyk'
    }
  } as const;

  readonly squares = Array.from({ length: 64 }, (_, i) => ({
    dark: (Math.floor(i / 8) + i) % 2 === 1
  }));

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

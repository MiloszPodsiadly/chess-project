import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, OnDestroy } from '@angular/core';
import { NgForOf } from '@angular/common';

export type ChessArenaState = 'LOBBY' | 'WAITING_FOR_OPPONENT' | 'MATCH_FOUND' | 'RECONNECTING' | 'ACTIVE_GAME';

@Component({
  selector: 'app-chess-arena-animation',
  standalone: true,
  imports: [NgForOf],
  templateUrl: './chess-arena-animation.component.html',
  styleUrl: './chess-arena-animation.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChessArenaAnimationComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() state: ChessArenaState = 'LOBBY';
  @Input() lang: 'en' | 'pl' = 'en';

  readonly squares = Array.from({ length: 64 }, (_, index) => index);
  readonly Math = Math;
  private observer: IntersectionObserver | null = null;
  private motionPreference: MediaQueryList | null = null;
  private elementVisible = true;
  private pageVisible = true;
  private reducedMotion = false;

  private readonly onMotionPreferenceChange = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches;
    this.syncPausedState();
  };
  private readonly onDocumentVisibilityChange = () => {
    this.pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    this.syncPausedState();
  };

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    if (typeof document !== 'undefined') {
      this.pageVisible = document.visibilityState === 'visible';
      document.addEventListener('visibilitychange', this.onDocumentVisibilityChange);
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.motionPreference.matches;
      this.motionPreference.addEventListener('change', this.onMotionPreferenceChange);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => {
        this.elementVisible = entries.some(entry => entry.isIntersecting);
        this.syncPausedState();
      }, { threshold: 0.05 });
      this.observer.observe(this.host.nativeElement);
    }
    this.syncPausedState();
  }

  ngOnChanges(): void {
    this.syncPausedState();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.motionPreference?.removeEventListener('change', this.onMotionPreferenceChange);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
    }
  }

  get statusLabel(): string {
    const labels = {
      en: {
        LOBBY: 'Online chess lobby',
        WAITING_FOR_OPPONENT: 'Waiting for an opponent',
        MATCH_FOUND: 'Opponent found',
        RECONNECTING: 'Reconnecting to the server',
        ACTIVE_GAME: 'Game in progress'
      },
      pl: {
        LOBBY: 'Lobby gry online',
        WAITING_FOR_OPPONENT: 'Oczekiwanie na przeciwnika',
        MATCH_FOUND: 'Znaleziono przeciwnika',
        RECONNECTING: 'Ponowne łączenie z serwerem',
        ACTIVE_GAME: 'Partia w toku'
      }
    };
    return labels[this.lang][this.state];
  }

  private syncPausedState(): void {
    const paused = !this.elementVisible || !this.pageVisible || this.reducedMotion || this.state === 'ACTIVE_GAME';
    this.host.nativeElement.classList.toggle('is-paused', paused);
  }
}

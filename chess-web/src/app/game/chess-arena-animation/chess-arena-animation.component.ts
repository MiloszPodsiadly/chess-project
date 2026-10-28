import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, OnDestroy } from '@angular/core';
import { ARENA_PIECES, ARENA_SQUARES } from './arena-scene';
import { ArenaMotionMemory } from './arena-motion-memory.service';

export type ChessArenaState = 'LOBBY' | 'WAITING_FOR_OPPONENT' | 'MATCH_FOUND' | 'RECONNECTING' | 'ACTIVE_GAME';
export type ChessArenaVariant = 'HERO' | 'LOBBY' | 'COMPACT';
let nextSceneId = 0;

@Component({
  selector: 'app-chess-arena-animation',
  standalone: true,
  templateUrl: './chess-arena-animation.component.html',
  styleUrl: './chess-arena-animation.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant' }
})
export class ChessArenaAnimationComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() state: ChessArenaState = 'LOBBY';
  @Input() lang: 'en' | 'pl' = 'en';
  @Input() variant: ChessArenaVariant = 'LOBBY';
  @Input() matchId: string | null = null;
  @Input() showCaption = true;
  readonly sceneId = `enchanted-arena-${nextSceneId++}`;
  readonly squares = ARENA_SQUARES;
  readonly pieces = ARENA_PIECES;
  readonly columns = [70, 220, 780, 930];
  private observer: IntersectionObserver | null = null;
  private motionPreference: MediaQueryList | null = null;
  private elementVisible = true;
  private pageVisible = true;
  private reducedMotion = false;
  private currentMatchId: string | null = null;
  private celebrate = false;

  private readonly onMotionPreferenceChange = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches;
    this.syncPausedState();
  };
  private readonly onDocumentVisibilityChange = () => {
    this.pageVisible = document.visibilityState === 'visible';
    this.syncPausedState();
  };

  constructor(private readonly host: ElementRef<HTMLElement>, private readonly memory: ArenaMotionMemory) {}

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
    const firstVisit = this.memory.claimIntro();
    this.host.nativeElement.classList.toggle('has-intro', firstVisit && !this.reducedMotion
      && (this.state === 'LOBBY' || this.state === 'WAITING_FOR_OPPONENT'));
    this.syncPausedState();
  }

  ngOnChanges(): void {
    if (this.state === 'MATCH_FOUND' && this.matchId && this.matchId !== this.currentMatchId) {
      this.currentMatchId = this.matchId;
      this.celebrate = this.memory.claimMatch(this.matchId);
    } else if (this.state !== 'MATCH_FOUND') {
      this.celebrate = false;
    }
    if (['MATCH_FOUND', 'RECONNECTING', 'ACTIVE_GAME'].includes(this.state)) {
      this.host.nativeElement.classList.remove('has-intro');
    }
    this.syncPausedState();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.motionPreference?.removeEventListener('change', this.onMotionPreferenceChange);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
  }

  ref(name: string) { return `${this.sceneId}-${name}`; }
  paint(name: string) { return `url(#${this.ref(name)})`; }
  get viewBox() {
    return this.variant === 'HERO' ? '0 0 1000 680' : this.variant === 'COMPACT' ? '80 170 840 450' : '25 90 950 550';
  }
  get title() { return this.lang === 'pl' ? 'Zaczarowana Arena' : 'The Enchanted Arena'; }
  get illustrationLabel() { return this.lang === 'pl' ? 'Ilustracja areny' : 'Arena illustration'; }
  get statusLabel(): string {
    const labels = {
      en: { LOBBY: 'Enter the arena', WAITING_FOR_OPPONENT: 'Waiting for an opponent', MATCH_FOUND: 'Opponent found', RECONNECTING: 'Reconnecting to the server', ACTIVE_GAME: 'Game in progress' },
      pl: { LOBBY: 'Wejdź na arenę', WAITING_FOR_OPPONENT: 'Oczekiwanie na przeciwnika', MATCH_FOUND: 'Znaleziono przeciwnika', RECONNECTING: 'Ponowne łączenie z serwerem', ACTIVE_GAME: 'Partia w toku' }
    };
    return labels[this.lang][this.state];
  }

  private syncPausedState(): void {
    const classes = this.host.nativeElement.classList;
    if (this.reducedMotion) {
      classes.remove('has-intro');
      this.celebrate = false;
    }
    classes.toggle('is-paused', !this.elementVisible || !this.pageVisible || this.reducedMotion || this.state === 'ACTIVE_GAME');
    classes.toggle('motion-reduced', this.reducedMotion);
    classes.toggle('is-match', this.celebrate);
  }
}

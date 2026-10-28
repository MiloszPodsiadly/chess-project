import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessArenaAnimationComponent } from './chess-arena-animation.component';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly unobserve = vi.fn();
  readonly takeRecords = vi.fn(() => []);

  constructor(private readonly callback: IntersectionObserverCallback,
              readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }

  notify(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

describe('ChessArenaAnimationComponent', () => {
  let fixture: ComponentFixture<ChessArenaAnimationComponent> | null = null;
  let reducedMotion = false;
  let motionChange: ((event: MediaQueryListEvent) => void) | null = null;
  let motionPreference: MediaQueryList;

  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    reducedMotion = false;
    motionChange = null;
    motionPreference = {
      media: '(prefers-reduced-motion: reduce)',
      get matches() { return reducedMotion; },
      onchange: null,
      addEventListener: vi.fn((_type, listener) => {
        motionChange = listener as (event: MediaQueryListEvent) => void;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    } as unknown as MediaQueryList;

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => motionPreference)
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    await TestBed.configureTestingModule({
      imports: [ChessArenaAnimationComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(ChessArenaAnimationComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
    if (originalVisibilityState) Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    else Reflect.deleteProperty(document, 'visibilityState');
  });

  it('keeps the illustration mounted without adding a caption during lobby recovery when captions are disabled', () => {
    fixture!.componentRef.setInput('showCaption', false);
    fixture!.detectChanges();
    const illustration = fixture!.nativeElement.querySelector('.arena-art svg');
    expect(illustration).not.toBeNull();
    expect(fixture!.nativeElement.querySelector('.arena-caption')).toBeNull();

    fixture!.componentRef.setInput('state', 'RECONNECTING');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.querySelector('.arena-art svg')).toBe(illustration);
    expect(fixture!.nativeElement.querySelector('.arena-caption')).toBeNull();

    fixture!.componentRef.setInput('state', 'LOBBY');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.querySelector('.arena-art svg')).toBe(illustration);
    expect(fixture!.nativeElement.querySelector('.arena-caption')).toBeNull();
  });

  it('renders the lobby and updates to waiting and match-found states', () => {
    const component = fixture!.componentInstance;
    const status = fixture!.nativeElement.querySelector('.arena-caption') as HTMLElement;
    const scene = fixture!.nativeElement.querySelector('.arena-animation') as HTMLElement;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('Enter the arena');
    expect(scene.querySelectorAll('.arena-square')).toHaveLength(64);
    expect(scene.querySelectorAll('.piece-position')).toHaveLength(32);
    expect(scene.querySelector('.arena-art')?.getAttribute('aria-hidden')).toBe('true');
    expect(scene.querySelector('svg')?.getAttribute('focusable')).toBe('false');

    fixture!.componentRef.setInput('lang', 'en');
    fixture!.componentRef.setInput('state', 'WAITING_FOR_OPPONENT');
    fixture!.detectChanges();
    expect(scene.classList.contains('state-waiting')).toBe(true);
    expect(status.textContent).toContain('Waiting for an opponent');

    fixture!.componentRef.setInput('matchId', 'match-1');
    fixture!.componentRef.setInput('state', 'MATCH_FOUND');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.classList.contains('is-match')).toBe(true);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(component.statusLabel).toBe('Opponent found');

    fixture!.componentRef.setInput('lang', 'pl');
    fixture!.componentRef.setInput('state', 'RECONNECTING');
    fixture!.detectChanges();
    expect(component.statusLabel).toBe('Ponowne łączenie z serwerem');
  });

  it('pauses active-game decoration so it cannot compete with gameplay', () => {
    fixture!.componentRef.setInput('state', 'ACTIVE_GAME');
    fixture!.detectChanges();

    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(true);
    expect(fixture!.nativeElement.querySelector('.arena-scene')).toBeNull();
    expect(fixture!.nativeElement.querySelector('.arena-caption').textContent).toContain('Game in progress');
  });

  it('pauses when outside the viewport and resumes when visible again', () => {
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(fixture!.nativeElement);

    observer.notify(false);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(true);

    observer.notify(true);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(false);
  });

  it('does not replay the intro or a celebrated match after route recreation', () => {
    expect(fixture!.nativeElement.classList.contains('has-intro')).toBe(true);
    fixture!.componentRef.setInput('matchId', 'unique-match');
    fixture!.componentRef.setInput('state', 'MATCH_FOUND');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.classList.contains('is-match')).toBe(true);
    fixture!.destroy();

    fixture = TestBed.createComponent(ChessArenaAnimationComponent);
    fixture.componentRef.setInput('matchId', 'unique-match');
    fixture.componentRef.setInput('state', 'MATCH_FOUND');
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('has-intro')).toBe(false);
    expect(fixture.nativeElement.classList.contains('is-match')).toBe(false);
  });

  it('cancels celebration for reconnect and rapid state changes without replaying a duplicate match', () => {
    fixture!.componentRef.setInput('matchId', 'rapid-match');
    fixture!.componentRef.setInput('state', 'MATCH_FOUND');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.classList.contains('is-match')).toBe(true);
    fixture!.componentRef.setInput('state', 'RECONNECTING');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.classList.contains('is-match')).toBe(false);
    fixture!.componentRef.setInput('state', 'MATCH_FOUND');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.classList.contains('is-match')).toBe(false);
    fixture!.componentRef.setInput('matchId', 'another-match');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.classList.contains('is-match')).toBe(true);
  });

  it('frames the same scene for hero, lobby and compact variants with unique SVG references', () => {
    const firstId = fixture!.componentInstance.sceneId;
    fixture!.componentRef.setInput('variant', 'HERO');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.querySelector('svg').getAttribute('viewBox')).toBe('0 0 1000 680');
    fixture!.componentRef.setInput('variant', 'COMPACT');
    fixture!.detectChanges();
    expect(fixture!.nativeElement.querySelector('svg').getAttribute('viewBox')).toBe('80 170 840 450');
    const other = TestBed.createComponent(ChessArenaAnimationComponent);
    other.detectChanges();
    expect(other.componentInstance.sceneId).not.toBe(firstId);
    other.destroy();
  });

  it('pauses for a hidden document and resumes on visibility restoration', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(true);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(false);
  });

  it('pauses for reduced motion and responds when the preference changes', () => {
    reducedMotion = true;
    motionChange?.({ matches: true } as MediaQueryListEvent);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(true);
    expect(fixture!.nativeElement.classList.contains('has-intro')).toBe(false);

    reducedMotion = false;
    motionChange?.({ matches: false } as MediaQueryListEvent);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(false);
    expect(fixture!.nativeElement.classList.contains('has-intro')).toBe(false);
  });

  it('starts paused when reduced motion is already enabled', async () => {
    fixture!.destroy();
    fixture = null;
    reducedMotion = true;
    fixture = TestBed.createComponent(ChessArenaAnimationComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.classList.contains('is-paused')).toBe(true);
  });

  it('disconnects observers and removes document and motion listeners on destroy', () => {
    const observer = FakeIntersectionObserver.instances[0];
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');

    fixture!.destroy();
    fixture = null;

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(motionPreference.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});

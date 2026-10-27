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

  it('renders the lobby and updates to waiting and match-found states', () => {
    const component = fixture!.componentInstance;
    const status = fixture!.nativeElement.querySelector('.arena-animation') as HTMLElement;
    expect(status.classList.contains('state-lobby')).toBe(true);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-label')).toBe('Online chess lobby');
    expect(status.querySelectorAll('.arena-square')).toHaveLength(64);

    fixture!.componentRef.setInput('lang', 'en');
    fixture!.componentRef.setInput('state', 'WAITING_FOR_OPPONENT');
    fixture!.detectChanges();
    expect(status.classList.contains('state-waiting')).toBe(true);
    expect(status.getAttribute('aria-label')).toBe('Waiting for an opponent');

    fixture!.componentRef.setInput('state', 'MATCH_FOUND');
    fixture!.detectChanges();
    expect(status.classList.contains('state-match-found')).toBe(true);
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
    expect(fixture!.nativeElement.querySelector('.arena-animation')
      .classList.contains('state-active')).toBe(true);
    expect(fixture!.nativeElement.querySelector('.arena-animation').getAttribute('aria-label'))
      .toBe('Game in progress');
  });

  it('pauses when outside the viewport and resumes when visible again', () => {
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(fixture!.nativeElement);

    observer.notify(false);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(true);

    observer.notify(true);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(false);
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

    reducedMotion = false;
    motionChange?.({ matches: false } as MediaQueryListEvent);
    expect(fixture!.nativeElement.classList.contains('is-paused')).toBe(false);
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

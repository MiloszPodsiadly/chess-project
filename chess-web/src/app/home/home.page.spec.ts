import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePageComponent } from './home.page';

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
let storedValues: Record<string, string>;

describe('HomePageComponent', () => {
  beforeEach(() => {
    storedValues = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues[key] ?? null,
        setItem: (key: string, value: string) => { storedValues[key] = value; }
      }
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage);
    else Reflect.deleteProperty(window, 'localStorage');
  });

  it('keeps the product name and provides complete Polish and English landing copy', () => {
    const home = new HomePageComponent();

    expect(home.translations.pl.langLabel).toBe('Język');
    expect(home.translations.pl.heroTitle).toBe('Graj z pomysłem.');
    expect(home.translations.pl.heroCopy).toContain('znajdź przeciwnika');
  });

  it('restores the saved language and announces language changes to the active game', () => {
    storedValues['lang'] = 'pl';
    const home = new HomePageComponent();
    const dispatch = vi.spyOn(window, 'dispatchEvent');

    expect(home.lang).toBe('pl');
    home.setLang('en');

    expect(home.lang).toBe('en');
    expect(storedValues['lang']).toBe('en');
    const event = dispatch.mock.calls[0][0] as StorageEvent;
    expect(event.type).toBe('storage');
    expect(event.key).toBe('lang');
    expect(event.newValue).toBe('en');
  });
});

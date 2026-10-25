import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EngineGameApiService, StrengthPreset } from '../../bot/engine-game-api.service';

type Execution = 'browser' | 'server';
type Flavor = 'lite' | 'full';
type Side = 'w' | 'b' | 'random';

@Component({ selector: 'app-bot-setup', standalone: true, imports: [NgForOf, NgIf, FormsModule],
  templateUrl: './bot-setup.component.html', styleUrl: './bot-setup.component.css' })
export class BotSetupComponent {
  @Input() lang: 'en' | 'pl' = 'en';
  @Input() execution: Execution = 'browser';
  @Input() flavor: Flavor = 'lite';
  @Input() elo = 1200;
  @Input() maximum = false;
  @Input() side: Side = 'w';
  @Input() serverPreset: StrengthPreset = 'STRONG';
  @Input() browserMaximumMs: 300 | 1000 | 3000 = 300;
  @Input() thinking = false;
  @Input() error = '';
  @Output() executionChange = new EventEmitter<Execution>();
  @Output() flavorChange = new EventEmitter<Flavor>();
  @Output() strengthChange = new EventEmitter<number | null>();
  @Output() sideChange = new EventEmitter<Side>();
  @Output() serverPresetChange = new EventEmitter<StrengthPreset>();
  @Output() browserMaximumMsChange = new EventEmitter<300 | 1000 | 3000>();
  @Output() start = new EventEmitter<void>();
  @Output() signedIn = new EventEmitter<void>();

  readonly choices = [
    { en: 'Rookie', pl: 'Nowicjusz', min: 200, max: 599, target: 400 },
    { en: 'Beginner', pl: 'Początkujący', min: 600, max: 999, target: 800 },
    { en: 'Casual', pl: 'Rekreacyjny', min: 1000, max: 1319, target: 1200 },
    { en: 'Intermediate', pl: 'Średni', min: 1320, max: 1799, target: 1500 },
    { en: 'Advanced', pl: 'Zaawansowany', min: 1800, max: 2299, target: 2000 },
    { en: 'Expert', pl: 'Ekspert', min: 2300, max: 2799, target: 2600 },
    { en: 'Master', pl: 'Mistrz', min: 2800, max: 3190, target: 3000 }
  ] as const;
  authOpen = false;
  authMode: 'login' | 'register' = 'login';
  username = '';
  email = '';
  password = '';
  authError = '';
  @ViewChild('authDialog') authDialog?: ElementRef<HTMLElement>;
  private authTrigger: HTMLElement | null = null;

  constructor(public readonly api: EngineGameApiService) {}

  get valid(): boolean { return this.maximum || Number.isInteger(this.elo) && this.elo >= 200 && this.elo <= 3190; }
  customValue(value: string | number) {
    this.strengthChange.emit(String(value).trim() === '' ? NaN : Number(value));
  }
  openAuth(event: Event) {
    this.authTrigger = event.currentTarget as HTMLElement;
    this.authOpen = true;
    setTimeout(() => this.authDialog?.nativeElement.querySelector<HTMLElement>('button')?.focus());
  }
  closeAuth() {
    this.authOpen = false;
    setTimeout(() => this.authTrigger?.focus());
  }
  async authenticate() {
    if (!this.username.trim() || !this.password || this.authMode === 'register' && !this.email.trim()) {
      this.authError = this.lang === 'pl' ? 'Wypełnij wymagane pola.' : 'Complete the required fields.';
      return;
    }
    try {
      await this.api.authenticate(this.username.trim(), this.password,
        this.authMode === 'register' ? this.email.trim() : undefined);
      this.password = '';
      this.authError = '';
      this.closeAuth();
      this.signedIn.emit();
    } catch (error) {
      this.authError = error instanceof Error ? error.message : 'Authentication failed';
    }
  }
  onAuthKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); this.closeAuth(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.authDialog?.nativeElement.querySelectorAll<HTMLElement>('button, input') ?? [])
      .filter(control => !control.hasAttribute('disabled'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}

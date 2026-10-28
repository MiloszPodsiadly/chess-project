import { describe, expect, it } from 'vitest';
import { MultiplayerLobbyComponent } from './multiplayer-lobby.component';

function lobby(translations: Readonly<Record<string, string>>) {
  const component = Object.create(MultiplayerLobbyComponent.prototype) as MultiplayerLobbyComponent;
  component.translations = translations;
  return component;
}

describe('MultiplayerLobbyComponent', () => {
  it('explains when an unverifiable recovered snapshot leaves the current board untouched', () => {
    const component = lobby({ snapshotRecoveryFailed: 'Your current board was kept.' });

    expect(component.onlineErrorMessage('snapshot_recovery_failed'))
      .toBe('Your current board was kept.');
  });

  it('uses the selected language for multiplayer recovery errors', () => {
    const component = lobby({ snapshotRecoveryFailed: 'Zachowano obecną planszę.' });

    expect(component.onlineErrorMessage('snapshot_recovery_failed'))
      .toBe('Zachowano obecną planszę.');
  });
});

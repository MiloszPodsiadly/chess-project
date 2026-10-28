import { describe, expect, it, vi } from 'vitest';
import { MultiplayerLobbyComponent } from './multiplayer-lobby.component';

function lobby(translations: Readonly<Record<string, string>>) {
  const component = new MultiplayerLobbyComponent({ clearLastError: vi.fn() } as any);
  component.translations = translations;
  return component;
}

describe('MultiplayerLobbyComponent', () => {
  it('keeps the Arena visible by default without selecting a lobby tab', () => {
    const component = lobby({});

    expect(component.onlineView).toBeNull();
    expect(component.tabIndexFor('public')).toBe(0);
    expect(component.tabIndexFor('create')).toBe(-1);
  });

  it('opens a lobby panel on selection and closes it when the selected tab is clicked again', () => {
    const component = lobby({});
    const panelViewChange = vi.fn();
    component.panelViewChange = { emit: panelViewChange } as any;

    component.setOnlineView('public');
    expect(component.onlineView).toBe('public');
    expect(panelViewChange).toHaveBeenLastCalledWith('public');

    component.setOnlineView('public');
    expect(component.onlineView).toBeNull();
    expect(panelViewChange).toHaveBeenLastCalledWith(null);
  });

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

  it('localizes room errors and legacy event aliases through the active dictionary', () => {
    const component = lobby({
      roomNotFoundError: 'Nie znaleziono pokoju.',
      wrongRoomPasswordError: 'Nieprawidłowe hasło.',
      roomCreateFailedError: 'Nie udało się utworzyć pokoju.',
      roomSpectateFailedError: 'Nie udało się dołączyć jako widz.',
      onlineActionFailed: 'Nie udało się wykonać akcji.'
    });

    expect(component.onlineErrorMessage('room_not_found')).toBe('Nie znaleziono pokoju.');
    expect(component.onlineErrorMessage('bad_password')).toBe('Nieprawidłowe hasło.');
    expect(component.onlineErrorMessage('roomCreateFailed'))
      .toBe('Nie udało się utworzyć pokoju.');
    expect(component.onlineErrorMessage('roomSpectateFailed'))
      .toBe('Nie udało się dołączyć jako widz.');
    expect(component.onlineErrorMessage('malformed_request')).toBe('Nie udało się wykonać akcji.');
  });

  it('blocks duplicate join form submissions while a room operation is pending', () => {
    const component = lobby({});
    const emit = vi.fn();
    (component as any).multiplayer = {
      hasPendingRoomOperation: () => true,
      pendingRoomOperation$: { subscribe: vi.fn() }
    } as any;
    component.joinRequested = { emit } as any;
    component.onlineRoomCode = 'ROOM2';

    component.joinOnlineRoom();

    expect(component.isRoomOperationPending()).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });
});

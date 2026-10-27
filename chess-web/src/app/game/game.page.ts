import { Component, DestroyRef, ChangeDetectorRef } from '@angular/core';
import { AsyncPipe, NgForOf, NgIf, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameStateService, type MoveView } from './game-state.service';
import { MultiplayerService } from '../multiplayer/multiplayer.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EngineAnalysisService } from '../analysis/engine-analysis.service';
import { BoardComponent } from './board/board.component';
import { MoveHistoryComponent } from './move-history/move-history.component';
import { GameControlsComponent } from './game-controls/game-controls.component';
import { AnalysisPanelComponent } from '../analysis/analysis-panel.component';
import { BotEngineService } from '../bot/bot-engine.service';
import { EngineGameApiService, EngineSessionExpiredError, ServerEngineGame, ServerEngineMode, StrengthPreset } from '../bot/engine-game-api.service';
import { Chess, type Square } from 'chess.js';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { GameStateSyncDto, TimeControlType } from '../multiplayer/models';
import { strengthCategory } from '../bot/strength-catalog';
import { GameOutcome, multiplayerOutcome as toMultiplayerOutcome, serverOutcome } from './game-outcome';
import { GameResultPanelComponent } from './game-result-panel/game-result-panel.component';
import { BotSetupComponent } from './bot-setup/bot-setup.component';
import { ChessArenaAnimationComponent, ChessArenaState } from './chess-arena-animation/chess-arena-animation.component';

type PieceCode = string | null;
type BotErrorScope = 'authentication' | 'configuration' | 'engine' | 'gameplay' | 'recovery';

@Component({
  selector: 'app-game-page',
  standalone: true,
  imports: [AsyncPipe, NgIf, NgForOf, DatePipe, FormsModule, RouterLink, BoardComponent, MoveHistoryComponent, GameControlsComponent, AnalysisPanelComponent, GameResultPanelComponent, BotSetupComponent, ChessArenaAnimationComponent],
  templateUrl: './game.page.html',
  styleUrl: './game.page.css'
})
export class GamePageComponent {
  pendingPromotion: { from: string; to: string } | null = null;
  promotionOptions = ['q', 'r', 'b', 'n'];
  botEnabled = false;
  botElo = 1200;
  botMaximum = false;
  botSidebarTab: 'analysis' | 'moves' | 'settings' = 'analysis';
  onBotTabKeydown(event: KeyboardEvent) {
    const tabs: Array<typeof this.botSidebarTab> = ['analysis', 'moves', 'settings'];
    const index = tabs.indexOf(this.botSidebarTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    this.botSidebarTab = tabs[next];
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  botColor: 'w' | 'b' = 'b';
  botSideChoice: 'w' | 'b' | 'random' = 'w';
  playerColor: 'w' | 'b' = 'w';
  botGameActive = false;
  botMode = false;
  botThinking = false;
  botResigned = false;
  dismissedOutcomeKey: string | null = null;
  botExecution: 'browser' | 'server' = 'browser';
  botEngineFlavor: 'lite' | 'full' = 'lite';
  analysisFlavor: 'lite' | 'full' = 'lite';

  setAnalysisFlavor(flavor: 'lite' | 'full') {
    this.analysisFlavor = flavor;
    this.analysis.setFlavor(flavor);
    if (this.botExecution === 'browser') this.analysis.scheduleAnalyze(this.state.fen$.value);
  }
  serverMode: ServerEngineMode = 'BEGINNER';
  serverPreset: StrengthPreset = 'STRONG';
  browserMaximumMs: 300 | 1000 | 3000 = 300;
  serverGame: ServerEngineGame | null = null;
  botErrorState: { scope: BotErrorScope; message: string } | null = null;
  get botError() { return this.botErrorState?.message ?? ''; }
  set botError(message: string) {
    this.botErrorState = message ? { scope: 'gameplay', message } : null;
  }
  private setBotError(scope: BotErrorScope, message: string) {
    this.botErrorState = { scope, message };
  }
  private setRequestError(error: unknown, fallback: string, scope: BotErrorScope = 'gameplay') {
    if (error instanceof EngineSessionExpiredError) {
      this.setBotError('authentication', this.t('sessionExpired'));
    } else {
      this.setBotError(scope, error instanceof Error ? error.message : fallback);
    }
  }
  private botEpoch = 0;
  private serverTurnPoll: number | null = null;
  private serverPollFailures = 0;
  showBotSetup = false;
  botPhase(): 'SETUP' | 'PLAYING' | 'FINISHED' {
    if (!this.botGameActive || this.showBotSetup) return 'SETUP';
    return this.botOutcome() ? 'FINISHED' : 'PLAYING';
  }
  analysisEnabled = true;
  evalHistory: number[] = [];
  onlineMode = false;
  onlineRoomName = '';
  onlineRoomPassword = '';
  onlineJoinPassword = '';
  onlinePublicRoom = true;
  chatMessage = '';
  onlineView: 'public' | 'create' | 'join' | 'manage' = 'public';
  private pendingOnlineAction: (() => void) | null = null;
  showOnlineSetup = false;
  onlineUsername = '';
  onlineTimeControl: TimeControlType = 'RAPID';
  onlineRoomCode = '';
  lang: 'en' | 'pl' = 'en';
  pendingServerMove = false;
  multiplayerHistoryMoves: MoveView[] = [];
  multiplayerReviewedGameId: string | null = null;
  displayWhiteMs: number | null = null;
  displayBlackMs: number | null = null;
  clockTimer: number | null = null;
  private onlineAutoConnected = false;
  sessionUsername: string | null = null;
  sessionUserId: number | null = null;
  private destroyed = false;
  private readonly onStorageChange = (event: StorageEvent) => {
    if (event.key === 'lang') this.syncLangFromStorage();
  };

  readonly translations = {
    en: {
      checkAlert: 'Check!',
      checkmateAlert: 'Checkmate',
      localGame: 'Local Game',
      subtitle: 'Engine-powered bot, analysis, and FIDE rules',
      onlineSetup: 'Online setup',
      onlineSetupSubtitle: 'Create a room or join instantly',
      playMode: 'Choose a play mode',
      playVsBotTab: 'Play vs Bot',
      multiplayerTab: 'Multiplayer',
      username: 'Username (optional)',
      timeControl: 'Time control',
      roomCode: 'Room code',
      roomName: 'Room name',
      publicRoom: 'Public room',
      roomPassword: 'Room password',
      joinPassword: 'Join password',
      publicRooms: 'Public rooms',
      createTab: 'Create',
      joinTab: 'Join',
      manageTab: 'Manage',
      publicTab: 'Public rooms',
      quickStart: 'Quick start',
      playingAs: 'Playing as',
      arenaPreview: 'Arena preview',
      connectFirst: 'Connect first',
      refresh: 'Refresh',
      host: 'Host',
      noPublicRooms: 'No public rooms yet.',
      spectate: 'Spectate',
      invite: 'Invite',
      inviteCreated: 'Room created',
      deleteRoom: 'Delete room',
      startGame: 'Start game',
      waitingForPlayer: 'Waiting for player',
      yourRoom: 'Your room',
      leaveRoom: 'Leave room',
      noActiveRoomTitle: 'No active room',
      noActiveRoomSubtitle: 'Create or join a room to manage it here.',
      roomMembers: 'Room members',
      roomPublic: 'Public',
      roomPrivate: 'Private',
      removePlayer: 'Remove',
      inviteExpires: 'Expires',
      inviteUses: 'Uses',
      chatTitle: 'Room chat',
      chatEmpty: 'No messages yet. Start the conversation.',
      chatPlaceholder: 'Type a message...',
      send: 'Send',
      spectator: 'Spectator',
      matchControls: 'Match controls',
      leaveLobby: 'Leave to lobby',
      backToLobby: 'Back to lobby',
      resign: 'Resign',
      offerDraw: 'Offer draw',
      acceptDraw: 'Accept draw',
      declineDraw: 'Decline draw',
      drawOfferTitle: 'Opponent offers a draw',
      drawOfferSubtitle: 'Accept or decline to continue.',
      gameOver: 'Game over',
      gameFinished: 'Game finished',
      yourTurn: 'Your turn',
      opponentTurn: "Opponent's turn",
      resultWin: 'You win',
      resultLoss: 'You lose',
      resultDraw: 'Draw',
      endCheckmate: 'Checkmate',
      endResign: 'Resignation',
      endTimeout: 'Time out',
      endDisconnectTimeout: 'Game ended after the opponent did not reconnect in time',
      endStalemate: 'Stalemate',
      endAgreement: 'Agreed draw',
      endRepetition: 'Threefold repetition',
      endFifty: 'Fifty-move rule',
      endInsufficient: 'Insufficient material',
      connect: 'Connect',
      connected: 'Connected',
      disconnected: 'Disconnected',
      connecting: 'Connecting to server...',
      authenticating: 'Signing in...',
      reconnecting: 'Server unavailable. Reconnecting...',
      recoveringGame: 'Restoring game state...',
      reconnectFailed: 'Reconnect failed. Try again.',
      recoveryFailed: 'Recovery failed. Reconnect or return to the lobby.',
      gameInProgress: 'Game in progress',
      onlineActionFailed: 'Multiplayer action failed. Please try again.',
      reconnectAckTimeout: 'The server did not confirm the reconnect. Retrying stopped; reconnect to restore the game.',
      invalidGameSnapshot: 'The recovered board could not be verified. Keeping the current board while requesting a fresh snapshot.',
      stateConflict: 'Game updates did not match. Checking the state with the server.',
      snapshotRecoveryFailed: 'The server could not provide a verifiable game state. Keeping the current board; reconnect to try again.',
      roomKicked: 'You were removed from the room.',
      roomClosedHostDeleted: 'The host deleted the room.',
      roomClosedHostLeft: 'The host left and closed the room.',
      roomClosedHostDisconnected: 'The host disconnected and closed the room.',
      roomClosedRoomExpired: 'The room expired.',
      roomClosedNoParticipants: 'The room closed because no participants remained.',
      roomClosed: 'Room was closed by the host.',
      roomDeleted: 'Room deleted.',
      opponentConnected: 'Opponent connected',
      opponentDisconnected: 'Opponent disconnected. Waiting for them to reconnect...',
      matchmakingQueued: 'Searching for an opponent...',
      cancelQueue: 'Cancel search',
      retryConnection: 'Retry connection',
      alreadyQueued: 'You are already in the matchmaking queue.',
      createRoom: 'Create room',
      joinRoom: 'Join room',
      matchmaking: 'Matchmaking',
      skip: 'Skip',
      botSetup: 'Bot setup',
      botSetupSubtitle: 'Configure strength, color, and analysis',
      engineLocation: 'Engine location', browserFast: 'Browser · fast local play',
      nativeServer: 'Native · server Stockfish 19', browserFlavor: 'Browser engine',
      browserTradeoff: 'Fast local moves; speed and strength depend on your device.',
      nativeTradeoff: 'Server play with configurable thinking time. Sign in to save games.',
      firstLoadNote: 'The first engine download can take longer. Later moves reuse the worker.',
      difficulty: 'Difficulty', difficultyNote: 'These ranges are intended settings, not measured FIDE ratings.',
      rookie: 'Rookie', beginner: 'Beginner', casual: 'Casual', intermediate: 'Intermediate',
      advanced: 'Advanced', expert: 'Expert', master: 'Master', maximum: 'Maximum',
      unrestricted: 'Unrestricted Stockfish 19', customLevel: 'Custom level (200–3190)',
      account: 'Account', accountName: 'Username', email: 'Email', password: 'Password',
      authRequired: 'Enter username and password; email is also required to register.',
      sessionExpired: 'Your server session expired. Sign in again.',
      analysisTab: 'Analysis', movesTab: 'Moves', settingsTab: 'Settings',
      nativeEngine: 'Stockfish 19 Native',
      browserEngine: 'Stockfish.js 19 (guest)',
      guestDescription: 'Play locally without an account. Games are not saved on the server.',
      serverDescription: 'Sign in to save games against native Stockfish 19.',
      signIn: 'Sign in',
      register: 'Register',
      signedIn: 'Signed in for server play',
      strengthMode: 'Strength mode',
      beginnerMode: 'Beginner · uncalibrated',
      trainingMode: 'Training · approximate Stockfish Elo',
      challengeMode: 'Challenge · full strength',
      searchBudget: 'Search budget',
      localAnalysisEngine: 'Local analysis engine',
      engineLoading: 'Loading local engine…',
      engineRetry: 'Retry engine turn',
      localLevel: 'local level',
      botMode: 'Bot mode',
      botColor: 'Bot color',
      botElo: 'Bot Elo',
      botPlayAs: 'Play as',
      botRandom: 'Random',
      botSkill: 'Skill',
      botProfile: 'Bot profile',
      botDepth: 'Depth cap',
      botMoveTime: 'Move time',
      botBlunder: 'Blunder rate',
      restartGame: 'Restart',
      exitGame: 'Exit',
      botLabel: 'Bot',
      botGameTitle: 'Bot game',
      preStartTitle: 'Ready to play?',
      preStartSubtitle: 'Pick your bot settings and start the game.',
      white: 'White',
      black: 'Black',
      youWonTitle: 'You won!',
      botWonTitle: 'Bot won!',
      resultSubtitle: 'Play again or adjust the bot settings.',
      hints: 'Hints',
      autoAnalysis: 'Auto analysis',
      startVsBot: 'Start vs Bot',
      botThinking: 'Bot thinking...',
      botReady: 'Ready',
      online: 'Online',
      offline: 'Offline',
      room: 'Room',
      token: 'Token',
      opponent: 'Opponent',
      you: 'You',
      guest: 'guest',
      guestPlaceholder: 'guest',
      roomNamePlaceholder: 'Friday Blitz',
      roomPasswordPlaceholder: 'secret',
      roomCodePlaceholder: 'ABC123',
      joinPasswordPlaceholder: 'password',
      statusLabel: 'Status:',
      moveHistory: 'Move history',
      moveCount: 'Moves',
      moveWhiteLabel: 'White',
      moveBlackLabel: 'Black',
      serverAnalysis: 'Server analysis',
      localAnalysis: 'Local analysis',
      hideHints: 'Hide hints',
      showHints: 'Show hints',
      promotionTitle: 'Choose promotion',
      cancel: 'Cancel'
    },
    pl: {
      checkAlert: 'Szach!',
      checkmateAlert: 'Mat',
      localGame: 'Gra lokalna',
      subtitle: 'Bot, analiza i zasady FIDE',
      onlineSetup: 'Ustawienia online',
      onlineSetupSubtitle: 'Utworz pokoj lub dolacz od razu',
      playMode: 'Wybierz tryb gry',
      playVsBotTab: 'Gra z botem',
      multiplayerTab: 'Multiplayer',
      username: 'Nazwa (opcjonalnie)',
      timeControl: 'Tempo gry',
      roomCode: 'Kod pokoju',
      roomName: 'Nazwa pokoju',
      publicRoom: 'Pokoj publiczny',
      roomPassword: 'Haslo pokoju',
      joinPassword: 'Haslo do pokoju',
      publicRooms: 'Publiczne pokoje',
      createTab: 'Utworz',
      joinTab: 'Dolacz',
      manageTab: 'Zarzadzaj',
      publicTab: 'Publiczne pokoje',
      quickStart: 'Szybki start',
      playingAs: 'Grasz jako',
      arenaPreview: 'Podglad Areny',
      connectFirst: 'Najpierw polacz',
      refresh: 'Odswiez',
      host: 'Gospodarz',
      noPublicRooms: 'Brak publicznych pokoi.',
      spectate: 'Ogladaj',
      invite: 'Zapros',
      inviteCreated: 'Pokoj utworzony',
      deleteRoom: 'Usun pokoj',
      startGame: 'Startuj gre',
      waitingForPlayer: 'Czekamy na gracza',
      yourRoom: 'Twoj pokoj',
      leaveRoom: 'Wyjdz z pokoju',
      noActiveRoomTitle: 'Brak aktywnego pokoju',
      noActiveRoomSubtitle: 'Utworz lub dolacz do pokoju, aby nim zarzadzac.',
      roomMembers: 'Uczestnicy pokoju',
      roomPublic: 'Publiczny',
      roomPrivate: 'Prywatny',
      removePlayer: 'Usun',
      inviteExpires: 'Wazne do',
      inviteUses: 'Uzycia',
      chatTitle: 'Czat pokoju',
      chatEmpty: 'Brak wiadomosci. Rozpocznij rozmowe.',
      chatPlaceholder: 'Napisz wiadomosc...',
      send: 'Wyslij',
      spectator: 'Widz',
      matchControls: 'Sterowanie gra',
      leaveLobby: 'Wroc do lobby',
      backToLobby: 'Wroc do lobby',
      resign: 'Poddaj',
      offerDraw: 'Zaproponuj remis',
      acceptDraw: 'Akceptuj remis',
      declineDraw: 'Odrzuc remis',
      drawOfferTitle: 'Przeciwnik proponuje remis',
      drawOfferSubtitle: 'Akceptuj lub odrzuc.',
      gameOver: 'Koniec gry',
      gameFinished: 'Partia zakonczona',
      yourTurn: 'Twoj ruch',
      opponentTurn: 'Ruch przeciwnika',
      resultWin: 'Wygrales',
      resultLoss: 'Przegrales',
      resultDraw: 'Remis',
      endCheckmate: 'Mat',
      endResign: 'Poddanie',
      endTimeout: 'Czas',
      endDisconnectTimeout: 'Partia zakonczona po uplywie czasu na powrot przeciwnika',
      endStalemate: 'Pat',
      endAgreement: 'Remis zgodny',
      endRepetition: 'Trzykrotne powtorzenie',
      endFifty: 'Regula 50 ruchow',
      endInsufficient: 'Niewystarczajacy material',
      connect: 'Polacz',
      connected: 'Polaczono',
      disconnected: 'Brak polaczenia',
      connecting: 'Laczenie z serwerem...',
      authenticating: 'Logowanie...',
      reconnecting: 'Serwer niedostepny. Ponawianie polaczenia...',
      recoveringGame: 'Przywracanie stanu partii...',
      reconnectFailed: 'Nie udalo sie polaczyc ponownie. Sprobuj jeszcze raz.',
      recoveryFailed: 'Nie udalo sie odzyskac partii. Polacz sie ponownie lub wroc do lobby.',
      gameInProgress: 'Partia trwa',
      onlineActionFailed: 'Nie udalo sie wykonac akcji multiplayer. Sprobuj ponownie.',
      reconnectAckTimeout: 'Serwer nie potwierdzil ponownego polaczenia. Ponawianie zatrzymano; polacz sie ponownie, aby przywrocic partie.',
      invalidGameSnapshot: 'Nie mozna zweryfikowac odzyskanej planszy. Zachowano obecna plansze i poproszono o nowy stan.',
      stateConflict: 'Aktualizacje partii sa niespojne. Sprawdzam stan na serwerze.',
      snapshotRecoveryFailed: 'Serwer nie dostarczyl wiarygodnego stanu partii. Zachowano obecna plansze; polacz sie ponownie, aby sprobowac jeszcze raz.',
      roomKicked: 'Usunieto Cie z pokoju.',
      roomClosedHostDeleted: 'Gospodarz usunal pokoj.',
      roomClosedHostLeft: 'Gospodarz opuscil pokoj i go zamknal.',
      roomClosedHostDisconnected: 'Gospodarz utracil polaczenie i zamknal pokoj.',
      roomClosedRoomExpired: 'Pokoj wygasl.',
      roomClosedNoParticipants: 'Pokoj zamknieto, bo nie pozostali w nim uczestnicy.',
      roomClosed: 'Gospodarz zamknal pokoj.',
      roomDeleted: 'Pokoj usuniety.',
      opponentConnected: 'Przeciwnik polaczony',
      opponentDisconnected: 'Przeciwnik utracil polaczenie. Czekamy na jego powrot...',
      matchmakingQueued: 'Szukamy przeciwnika...',
      cancelQueue: 'Anuluj szukanie',
      retryConnection: 'Polacz ponownie',
      alreadyQueued: 'Jestes juz w kolejce matchmakingu.',
      createRoom: 'Utworz pokoj',
      joinRoom: 'Dolacz do pokoju',
      matchmaking: 'Matchmaking',
      skip: 'Pomin',
      botSetup: 'Ustawienia bota',
      botSetupSubtitle: 'Ustaw sile, kolor i analize',
      engineLocation: 'Miejsce działania silnika', browserFast: 'Przeglądarka · szybka gra lokalna',
      nativeServer: 'Natywny · Stockfish 19 na serwerze', browserFlavor: 'Silnik przeglądarki',
      browserTradeoff: 'Szybkie ruchy lokalne; tempo i siła zależą od urządzenia.',
      nativeTradeoff: 'Gra na serwerze z wyborem czasu namysłu. Zaloguj się, aby zapisać partię.',
      firstLoadNote: 'Pierwsze pobranie silnika może potrwać dłużej. Następne ruchy używają tego samego silnika.',
      difficulty: 'Poziom trudności', difficultyNote: 'Przedziały to ustawienia, nie zmierzone rankingi FIDE.',
      rookie: 'Nowicjusz', beginner: 'Początkujący', casual: 'Swobodny', intermediate: 'Średni',
      advanced: 'Zaawansowany', expert: 'Ekspert', master: 'Mistrz', maximum: 'Maksimum',
      unrestricted: 'Stockfish 19 bez ograniczeń', customLevel: 'Własny poziom (200–3190)',
      account: 'Konto', accountName: 'Nazwa użytkownika', email: 'Email', password: 'Hasło',
      authRequired: 'Podaj nazwę użytkownika i hasło; przy rejestracji także email.',
      sessionExpired: 'Sesja na serwerze wygasła. Zaloguj się ponownie.',
      analysisTab: 'Analiza', movesTab: 'Ruchy', settingsTab: 'Ustawienia',
      nativeEngine: 'Stockfish 19 na serwerze',
      browserEngine: 'Stockfish.js 19 (gosc)',
      guestDescription: 'Graj lokalnie bez konta. Partie nie sa zapisywane na serwerze.',
      serverDescription: 'Zaloguj sie, aby zapisywac partie ze Stockfishem 19 na serwerze.',
      signIn: 'Zaloguj',
      register: 'Zarejestruj',
      signedIn: 'Zalogowano do gry na serwerze',
      strengthMode: 'Tryb sily',
      beginnerMode: 'Poczatkujacy · bez kalibracji Elo',
      trainingMode: 'Trening · przyblizone Elo Stockfisha',
      challengeMode: 'Wyzwanie · pelna sila',
      searchBudget: 'Czas namyslu',
      localAnalysisEngine: 'Lokalny silnik analizy',
      engineLoading: 'Ladowanie lokalnego silnika…',
      engineRetry: 'Ponow ture silnika',
      localLevel: 'poziom lokalny',
      botMode: 'Tryb bota',
      botColor: 'Kolor bota',
      botElo: 'Elo bota',
      botPlayAs: 'Grasz jako',
      botRandom: 'Losowo',
      botSkill: 'Poziom',
      botProfile: 'Profil bota',
      botDepth: 'Glebokosc',
      botMoveTime: 'Czas ruchu',
      botBlunder: 'Blad',
      restartGame: 'Od nowa',
      exitGame: 'Wyjdz',
      botLabel: 'Bot',
      botGameTitle: 'Gra z botem',
      preStartTitle: 'Gotowy do gry?',
      preStartSubtitle: 'Ustaw bota i rozpocznij gre.',
      white: 'Biale',
      black: 'Czarne',
      youWonTitle: 'Wygrales!',
      botWonTitle: 'Bot wygral!',
      resultSubtitle: 'Mozesz zagrac od nowa lub zmienic ustawienia.',
      hints: 'Podpowiedzi',
      autoAnalysis: 'Auto analiza',
      startVsBot: 'Start z botem',
      botThinking: 'Bot mysli...',
      botReady: 'Gotowy',
      online: 'Online',
      offline: 'Offline',
      room: 'Pokoj',
      token: 'Token',
      opponent: 'Przeciwnik',
      you: 'Ty',
      guest: 'gosc',
      guestPlaceholder: 'gosc',
      roomNamePlaceholder: 'Piatek Blitz',
      roomPasswordPlaceholder: 'sekret',
      roomCodePlaceholder: 'ABC123',
      joinPasswordPlaceholder: 'haslo',
      statusLabel: 'Status:',
      moveHistory: 'Historia ruchow',
      moveCount: 'Ruchy',
      moveWhiteLabel: 'Biale',
      moveBlackLabel: 'Czarne',
      serverAnalysis: 'Analiza serwera',
      localAnalysis: 'Analiza lokalna',
      hideHints: 'Ukryj podpowiedzi',
      showHints: 'Pokaz podpowiedzi',
      promotionTitle: 'Wybierz promocje',
      cancel: 'Anuluj'
    }
  } as const;

  constructor(
    public readonly state: GameStateService,
    public readonly multiplayer: MultiplayerService,
    public readonly analysis: EngineAnalysisService,
    private readonly botEngine: BotEngineService,
    public readonly engineApi: EngineGameApiService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
    destroyRef: DestroyRef
  ) {
    this.botExecution = this.engineApi.authenticated ? 'server' : 'browser';
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.invalidateBotSession();
      this.analysis.stop();
      window.removeEventListener('storage', this.onStorageChange);
      if (this.clockTimer) {
        window.clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
    });
    this.multiplayer.gameState$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((game) => {
        if (!game) {
          this.displayWhiteMs = null;
          this.displayBlackMs = null;
          return;
        }
        this.displayWhiteMs = game.whiteTimeLeftMs;
        this.displayBlackMs = game.blackTimeLeftMs;
      });

    if (!this.clockTimer) {
      this.clockTimer = window.setInterval(() => {
        if (this.destroyed) {
          return;
        }
        const game = this.multiplayer.gameState$.value;
        if (!game || game.result !== 'ONGOING' || this.multiplayer.timeControl$.value === 'UNTIMED') {
          return;
        }
        const lastMoveAt = game.lastMoveAt ? Date.parse(game.lastMoveAt) : Date.now();
        const elapsed = Math.max(0, Date.now() - lastMoveAt);
        let white = game.whiteTimeLeftMs;
        let black = game.blackTimeLeftMs;
        if (game.sideToMove === 'WHITE') {
          white = Math.max(0, white - elapsed);
        } else {
          black = Math.max(0, black - elapsed);
        }
        this.displayWhiteMs = white;
        this.displayBlackMs = black;
        this.cdr.detectChanges();
      }, 1000);
    }

    this.multiplayer.gameState$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((game) => {
        if (!game) {
          this.pendingServerMove = false;
          this.multiplayerHistoryMoves = [];
          return;
        }
        try {
          this.multiplayerHistoryMoves = this.buildMultiplayerHistory(game);
          this.state.loadExternalState(game.fen, this.multiplayerHistoryMoves,
            game.sideToMove === 'WHITE' ? 'w' : 'b');
        } catch (error) {
          this.state.status$.next(error instanceof Error ? error.message : 'Invalid game history');
          return;
        }
        this.pendingPromotion = null;
        this.pendingServerMove = false;
        if (game.analysis) {
          this.analysis.applyExternalAnalysis(game.analysis, game.fen);
        } else {
          this.analysis.useLocalAnalysis();
          this.analysis.scheduleAnalyze(game.fen);
        }
      });

    this.multiplayer.ready$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((ready) => {
        if (ready && this.pendingOnlineAction) {
          const action = this.pendingOnlineAction;
          this.pendingOnlineAction = null;
          action();
        }
      });

    this.multiplayer.connected$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((connected) => {
        if (!connected) {
          this.clearMultiplayerSelection();
        }
      });

    this.multiplayer.connectionState$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((connectionState) => {
        if (connectionState !== 'READY') {
          this.clearMultiplayerSelection();
        }
      });

    this.multiplayer.sessionUsername$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((username) => {
        this.sessionUsername = username;
        if (username) {
          this.onlineUsername = username;
          this.safeSessionSet('onlineUsername', username);
        }
      });

    this.multiplayer.sessionUserId$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((userId) => {
        this.sessionUserId = userId;
      });

    this.multiplayer.lastError$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => {
        this.pendingServerMove = false;
      });

    this.analysis.completedEvaluation$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((completed) => {
        if (!completed || !this.analysis.enabled$.value || completed.fen !== this.state.fen$.value) return;
        const value = this.parseEvalValue(completed.value);
        if (value == null) {
          return;
        }
        const index = this.state.moves$.value.length;
        this.evalHistory[index] = value;
        if (this.evalHistory.length > index + 1) {
          this.evalHistory = this.evalHistory.slice(0, index + 1);
        }
      });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((params) => {
        const mode = params.get('mode');
        if (this.botMode && mode !== 'bot') this.invalidateBotSession();
        if (mode === 'bot') {
          if (this.multiplayer.connected$.value || this.multiplayer.gameState$.value?.gameId) {
            this.disconnectOnlineSession();
          }
        }
        if (this.onlineMode && mode !== 'online') {
          const activeGame = this.multiplayer.gameState$.value?.result === 'ONGOING';
          if (activeGame) {
            this.multiplayer.leaveGame();
            this.multiplayer.disconnect();
          } else {
            this.multiplayer.leaveRoom();
            this.multiplayer.disconnect();
          }
          this.multiplayer.clearLastError();
        }
        this.showBotSetup = mode === 'bot';
        this.showOnlineSetup = mode === 'online';
        this.botMode = mode === 'bot';
        this.onlineMode = mode === 'online';
        if (this.onlineMode) {
          this.loadOnlineDefaults();
        }
        if (this.botMode) {
          this.botErrorState = null;
          void this.engineApi.validateSession().then(() => this.cdr.markForCheck());
          this.safeSessionRemove('onlineUsername');
          this.onlineUsername = '';
          this.botGameActive = false;
          this.botEnabled = false;
          this.analysis.stop();
          this.evalHistory = [];
          if (this.botExecution === 'server') void this.resumeServerBotGame();
          else void this.botEngine.warm(this.botEngineFlavor).catch(error => {
            if (!this.destroyed && this.showBotSetup) this.setBotError('engine', error.message);
          });
        } else {
          this.botGameActive = false;
          this.botEnabled = false;
        }
        if (this.onlineMode) {
          this.ensureOnlineConnected();
        }
      });
    this.syncLangFromStorage();
    window.addEventListener('storage', this.onStorageChange);
  }

  onSquareClick(square: string) {
    if (!this.canHumanMove()) {
      return;
    }
    const selected = this.state.selectedSquare$.value;
    if (!selected) {
      this.state.selectSquare(square);
      return;
    }
    if (selected === square) {
      this.state.selectSquare(square);
      return;
    }
    if (this.needsPromotion(selected, square)) {
      this.pendingPromotion = { from: selected, to: square };
      return;
    }
    const multiplayerGameId = this.multiplayer.gameState$.value?.gameId;
    if (multiplayerGameId) {
      this.pendingServerMove = true;
      this.state.clearSelection();
      this.multiplayer.makeMove(multiplayerGameId, {
        from: selected,
        to: square
      });
      return;
    }
    if (this.botMode && this.botExecution === 'server') {
      void this.submitServerBotMove(selected, square);
      return;
    }
    const moved = this.state.attemptMove(selected, square);
    if (moved) {
      this.analysis.scheduleAnalyze(this.state.fen$.value);
      this.maybeBotMove();
    }
  }

  private clearMultiplayerSelection() {
    this.pendingServerMove = false;
    this.pendingPromotion = null;
    this.state.clearSelection();
  }

  choosePromotion(piece: string) {
    if (!this.pendingPromotion) {
      return;
    }
    if (!this.canHumanMove()) {
      return;
    }
    const multiplayerGameId = this.multiplayer.gameState$.value?.gameId;
    if (multiplayerGameId) {
      this.pendingServerMove = true;
      this.state.clearSelection();
      this.multiplayer.makeMove(multiplayerGameId, {
        from: this.pendingPromotion.from,
        to: this.pendingPromotion.to,
        promotion: piece
      });
      this.pendingPromotion = null;
      return;
    }
    if (this.botMode && this.botExecution === 'server') {
      const { from, to } = this.pendingPromotion;
      this.pendingPromotion = null;
      void this.submitServerBotMove(from, to, piece);
      return;
    }
    const moved = this.state.attemptMove(this.pendingPromotion.from, this.pendingPromotion.to, piece);
    if (moved) {
      this.analysis.scheduleAnalyze(this.state.fen$.value);
      this.maybeBotMove();
    }
    this.pendingPromotion = null;
  }

  async maybeBotMove() {
    if (this.destroyed || this.botExecution !== 'browser' || !this.botEnabled
        || this.isGameFinished() || this.multiplayer.gameState$.value?.gameId) {
      return;
    }
    if (this.state.sideToMove$.value !== this.botColor) {
      return;
    }
    if (this.botThinking) {
      return;
    }
    this.botThinking = true;
    this.analysis.stop();
    const epoch = this.botEpoch;
    const fen = this.state.fen$.value;
    let move: string;
    try {
      move = await this.botEngine.getMove(fen, this.botMaximum ? null : this.botElo,
        this.botEngineFlavor, this.browserMaximumMs);
    } catch (error) {
      if (epoch === this.botEpoch) {
        this.botThinking = false;
        this.setBotError('engine', error instanceof Error ? error.message : 'Browser engine failed');
      }
      return;
    }
    if (epoch !== this.botEpoch || this.state.fen$.value !== fen) return;
    if (!move || move.length < 4) {
      this.botThinking = false;
      return;
    }
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move.length > 4 ? move[4] : undefined;
    const legal = new Chess(fen).moves({ verbose: true }).some(candidate =>
      candidate.from === from && candidate.to === to && (candidate.promotion ?? undefined) === promotion);
    if (!legal) {
      this.botThinking = false;
      this.setBotError('engine', 'Browser engine returned an illegal move');
      return;
    }
    const moved = this.state.attemptMove(from, to, promotion);
    if (moved) {
      this.analysis.scheduleAnalyze(this.state.fen$.value);
    }
    this.botThinking = false;
  }

  selectStrength(target: number) {
    this.botMaximum = false;
    this.botElo = target;
    this.serverMode = target < 1320 ? 'BEGINNER' : 'TRAINING';
  }

  selectMaximum() {
    this.botMaximum = true;
    this.serverMode = 'FULL_STRENGTH';
  }

  onSetupStrength(target: number | null) {
    if (target === null) this.selectMaximum();
    else this.onCustomStrength(target);
  }

  onCustomStrength(value: number) {
    this.botMaximum = false;
    this.botElo = value;
    if (Number.isInteger(value) && value >= 200 && value <= 3190) {
      this.serverMode = value < 1320 ? 'BEGINNER' : 'TRAINING';
    }
  }

  private async resumeServerBotGame() {
    const epoch = this.botEpoch;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem('chessEngineGameId');
      const color = sessionStorage.getItem('chessEnginePlayerColor');
      if (color === 'w' || color === 'b') {
        this.playerColor = color;
        this.botColor = color === 'w' ? 'b' : 'w';
      }
    } catch { return; }
    if (!id) return;
    try {
      if (!await this.engineApi.validateSession()) {
        if (epoch === this.botEpoch) this.setBotError('authentication', this.t('sessionExpired'));
        return;
      }
      const game = await this.engineApi.get(id);
      if (epoch === this.botEpoch && !this.destroyed && this.botExecution === 'server') {
        this.applyServerBotGame(game);
      }
    } catch (error) {
      if (epoch === this.botEpoch && !this.destroyed) {
        this.setRequestError(error, 'Could not resume game', 'recovery');
      }
    }
  }

  private async submitServerBotMove(from: string, to: string, promotion?: string) {
    const game = this.serverGame;
    if (this.pendingServerMove || !game || game.turnState !== 'PLAYER_TURN' || game.result !== 'ONGOING') return;
    if (this.state.sideToMove$.value !== this.playerColor) return;
    this.pendingServerMove = true;
    const epoch = ++this.botEpoch;
    this.botThinking = true;
    this.botError = '';
    this.state.clearSelection();
    try {
      const response = await this.engineApi.move(game.gameId, game.version, { from, to, promotion });
      if (epoch === this.botEpoch && !this.destroyed) this.applyServerBotGame(response);
    } catch (error) {
      if (epoch !== this.botEpoch) return;
      this.setRequestError(error, 'Move failed');
      try {
        const refreshed = await this.engineApi.get(game.gameId);
        if (epoch === this.botEpoch && !this.destroyed) this.applyServerBotGame(refreshed);
      } catch { this.botThinking = false; }
    } finally {
      if (epoch === this.botEpoch) this.pendingServerMove = false;
    }
  }

  private applyServerBotGame(game: ServerEngineGame) {
    if (this.serverGame?.gameId === game.gameId
        && (game.version < this.serverGame.version
          || (this.serverGame.result !== 'ONGOING' && game.result === 'ONGOING'))) return;
    try {
      this.state.loadExternalState(game.fen,
        game.moves.map(move => ({ san: '', from: move.from, to: move.to,
          promotion: move.promotion ?? undefined })),
        game.sideToMove === 'WHITE' ? 'w' : 'b');
    } catch (error) {
      this.setBotError('recovery', error instanceof Error ? error.message : 'Invalid server game history');
      this.botThinking = false;
      return;
    }
    this.botError = '';
    if (this.serverTurnPoll !== null) window.clearTimeout(this.serverTurnPoll);
    this.serverTurnPoll = null;
    this.serverPollFailures = 0;
    this.playerColor = game.playerColor === 'WHITE' ? 'w' : 'b';
    this.botColor = this.playerColor === 'w' ? 'b' : 'w';
    this.serverGame = game;
    this.serverMode = game.engineMode ?? this.serverMode;
    this.botMaximum = this.serverMode === 'FULL_STRENGTH';
    this.serverPreset = game.enginePreset ?? this.serverPreset;
    if (game.engineElo != null) this.botElo = game.engineElo;
    this.botThinking = game.turnState === 'ENGINE_THINKING';
    this.botEnabled = true;
    this.botGameActive = true;
    this.botResigned = false;
    this.showBotSetup = false;
    try { sessionStorage.setItem('chessEngineGameId', game.gameId); } catch { /* Private browsing. */ }
    try { sessionStorage.setItem('chessEnginePlayerColor', this.playerColor); } catch { /* Private browsing. */ }
    if (game.result !== 'ONGOING') {
      this.state.status$.next(game.result === 'DRAW' ? 'Draw' : game.endReason === 'CHECKMATE'
        ? 'Checkmate' : 'Game over');
    } else if (game.turnState === 'ENGINE_FAILED') {
      this.setBotError('engine', game.engineError ?? 'Engine move failed. Retry the turn.');
    }
    if (game.turnState === 'ENGINE_THINKING') this.analysis.stop();
    else this.analysis.scheduleAnalyze(game.fen);
    if (game.turnState === 'ENGINE_THINKING') this.pollServerEngineTurn(game.gameId, this.botEpoch);
    this.cdr.markForCheck();
  }

  private pollServerEngineTurn(gameId: string, epoch: number, delayMs = 700) {
    this.serverTurnPoll = window.setTimeout(async () => {
      if (this.destroyed || epoch !== this.botEpoch || this.serverGame?.gameId !== gameId) return;
      try {
        const game = await this.engineApi.get(gameId);
        if (this.destroyed || epoch !== this.botEpoch || this.serverGame?.gameId !== gameId) return;
        this.applyServerBotGame(game);
      } catch (error) {
        if (this.destroyed || epoch !== this.botEpoch) return;
        this.serverPollFailures++;
        if (this.serverPollFailures >= 3) this.setRequestError(error,
          'Connection lost while waiting for the engine', 'recovery');
        this.botThinking = true;
        this.cdr.markForCheck();
        this.pollServerEngineTurn(gameId, epoch, Math.min(5000, 1000 * this.serverPollFailures));
      }
    }, delayMs);
  }

  async retryServerBotTurn() {
    const game = this.serverGame;
    if (!game) return;
    const epoch = ++this.botEpoch;
    this.botThinking = true;
    try {
      const response = await this.engineApi.retry(game.gameId);
      if (epoch === this.botEpoch) this.applyServerBotGame(response);
    } catch (error) {
      if (epoch === this.botEpoch) {
        this.botThinking = false;
        this.setRequestError(error, 'Retry failed', 'recovery');
      }
    }
  }

  private disconnectOnlineSession() {
    const activeGame = this.multiplayer.gameState$.value?.result === 'ONGOING';
    if (activeGame) {
      this.multiplayer.leaveGame();
      this.multiplayer.disconnect();
    } else {
      this.multiplayer.leaveRoom();
      this.multiplayer.disconnect();
    }
    this.multiplayer.clearLastError();
  }

  async startBotGame() {
    if (!this.botMaximum && !this.validStrengthTarget()) {
      this.setBotError('configuration', 'Strength target must be a whole number from 200 to 3190');
      return;
    }
    this.invalidateBotSession();
    this.botSidebarTab = 'analysis';
    if (this.multiplayer.connected$.value || this.onlineMode) {
      this.disconnectOnlineSession();
    }
    const chosen =
      this.botSideChoice === 'random'
        ? Math.random() > 0.5
          ? 'w'
          : 'b'
        : this.botSideChoice;
    this.playerColor = chosen;
    this.botColor = chosen === 'w' ? 'b' : 'w';
    try { sessionStorage.setItem('chessEnginePlayerColor', this.playerColor); } catch { /* Private browsing. */ }
    if (this.botExecution === 'server') {
      const epoch = ++this.botEpoch;
      this.botThinking = true;
      this.botError = '';
      try {
        const game = await this.engineApi.create(this.playerColor, this.botElo,
          this.serverMode, this.serverPreset);
        if (epoch === this.botEpoch) this.applyServerBotGame(game);
      } catch (error) {
        if (epoch === this.botEpoch) {
          this.botThinking = false;
          this.setRequestError(error, 'Could not start game');
        }
      }
      return;
    }
    this.botEnabled = true;
    this.botGameActive = true;
    this.botResigned = false;
    this.botSidebarTab = 'analysis';
    this.showBotSetup = false;
    this.state.reset();
    this.evalHistory = [];
    this.syncAnalysisSetting();
    if (this.botColor === 'w') {
      this.maybeBotMove();
    }
  }

  async restartBotGame() {
    if (!this.botMode) {
      return;
    }
    this.invalidateBotSession();
    this.botSidebarTab = 'analysis';
    if (this.multiplayer.connected$.value || this.onlineMode) {
      this.disconnectOnlineSession();
    }
    if (this.botExecution === 'server' && this.serverGame) {
      const epoch = ++this.botEpoch;
      this.botThinking = true;
      try {
        const game = await this.engineApi.restart(this.serverGame.gameId);
        if (epoch === this.botEpoch) this.applyServerBotGame(game);
      } catch (error) {
        if (epoch === this.botEpoch) {
          this.botThinking = false;
          this.setRequestError(error, 'Restart failed');
        }
      }
      return;
    }
    this.botEnabled = true;
    this.botGameActive = true;
    this.botResigned = false;
    this.showBotSetup = false;
    this.state.reset();
    this.evalHistory = [];
    this.syncAnalysisSetting();
    if (this.botColor === 'w') {
      this.maybeBotMove();
    }
  }

  async exitToBotSetup() {
    if (!this.botMode) {
      return;
    }
    this.invalidateBotSession();
    const epoch = this.botEpoch;
    const previous = this.serverGame;
    this.serverGame = null;
    try { sessionStorage.removeItem('chessEngineGameId'); } catch { /* Private browsing. */ }
    this.botEnabled = false;
    this.botGameActive = false;
    this.showBotSetup = true;
    this.state.reset();
    this.evalHistory = [];
    this.analysis.stop();
    if (this.botExecution === 'server' && previous?.result === 'ONGOING') {
      try { await this.engineApi.resign(previous.gameId); }
      catch (error) {
        if (epoch === this.botEpoch) this.setRequestError(error, 'Could not resign');
      }
    }
  }

  async resignBotGame() {
    if (!this.botGameActive || this.isGameFinished()) return;
    this.invalidateBotSession();
    const epoch = this.botEpoch;
    if (this.botExecution === 'server' && this.serverGame) {
      try {
        const game = await this.engineApi.resign(this.serverGame.gameId);
        if (epoch === this.botEpoch) this.applyServerBotGame(game);
      } catch (error) {
        if (epoch === this.botEpoch) this.setRequestError(error, 'Could not resign');
      }
    } else {
      this.botResigned = true;
      this.state.status$.next(this.t('endResign'));
    }
  }

  connectOnline() {
    const username = this.onlineUsername || this.safeSessionGet('onlineUsername') || undefined;
    this.multiplayer.connect(username);
    this.multiplayer.listRooms();
  }

  private ensureOnlineConnected() {
    if (this.onlineAutoConnected) {
      return;
    }
    if (this.multiplayer.connected$.value) {
      this.multiplayer.listRooms();
      this.onlineAutoConnected = true;
      return;
    }
    this.onlineAutoConnected = true;
    this.connectOnline();
  }

  private loadOnlineDefaults() {
    const savedUser = this.safeSessionGet('onlineUsername');
    if (savedUser && !this.onlineUsername) {
      this.onlineUsername = savedUser;
    }
  }

  startOnlineMatchmaking() {
    this.runOnlineAction(() => {
      this.multiplayer.queueMatchmaking(this.onlineTimeControl);
    });
  }

  createOnlineRoom() {
    this.runOnlineAction(() => {
      this.multiplayer.createRoom(this.onlineTimeControl, {
        name: this.onlineRoomName.trim() || undefined,
        password: this.onlinePublicRoom ? null : (this.onlineRoomPassword.trim() || null),
        isPublic: this.onlinePublicRoom
      });
      this.showOnlineSetup = false;
    });
  }

  joinOnlineRoom() {
    if (!this.onlineRoomCode) {
      return;
    }
    this.runOnlineAction(() => {
      this.multiplayer.joinRoom(this.onlineRoomCode, this.onlineJoinPassword.trim() || null, null);
      this.showOnlineSetup = false;
    });
  }


  startRoomGame(roomCode: string) {
    if (!roomCode) {
      return;
    }
    this.runOnlineAction(() => {
      this.multiplayer.startRoomGame(roomCode);
    });
  }

  getYourClockMs(game: { whiteTimeLeftMs: number; blackTimeLeftMs: number }) {
    const yourColor = this.multiplayer.yourColor$.value;
    if (yourColor === 'BLACK') {
      return this.displayBlackMs ?? game.blackTimeLeftMs;
    }
    return this.displayWhiteMs ?? game.whiteTimeLeftMs;
  }

  getOpponentClockMs(game: { whiteTimeLeftMs: number; blackTimeLeftMs: number }) {
    const yourColor = this.multiplayer.yourColor$.value;
    if (yourColor === 'BLACK') {
      return this.displayWhiteMs ?? game.whiteTimeLeftMs;
    }
    return this.displayBlackMs ?? game.blackTimeLeftMs;
  }

  formatClock(ms: number | null | undefined) {
    if (ms == null) {
      return '--:--';
    }
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  formatTimeControl(type: TimeControlType | null | undefined) {
    if (!type) {
      return '';
    }
    switch (type) {
      case 'BULLET':
        return '1+0';
      case 'BLITZ':
        return '3+0';
      case 'RAPID':
        return '10+0';
      case 'CLASSICAL':
        return '30+0';
      case 'UNTIMED':
        return 'INF';
      default:
        return '';
    }
  }

  boardOrientation(): 'white' | 'black' {
    const multiplayerGame = this.multiplayer.gameState$.value;
    if (multiplayerGame) {
      if (this.multiplayer.yourColor$.value === 'BLACK') {
        return 'black';
      }
      return 'white';
    }
    if (this.botEnabled) {
      return this.playerColor === 'w' ? 'white' : 'black';
    }
    if (this.botMode && this.botSideChoice !== 'random') {
      return this.botSideChoice === 'w' ? 'white' : 'black';
    }
    return 'white';
  }

  cancelPromotion() {
    this.pendingPromotion = null;
  }

  pieceAt(board: PieceCode[][], square: string): PieceCode {
    const fileIndex = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rankIndex = 8 - Number(square[1]);
    return board?.[rankIndex]?.[fileIndex] ?? null;
  }

  private needsPromotion(from: string, to: string) {
    const fen = this.state.fen$.value;
    const board = this.boardFromFen(fen);
    const piece = this.pieceAt(board, from);
    if (!piece) {
      return false;
    }
    const isPawn = piece.toLowerCase() === 'p';
    const targetRank = to[1];
    return isPawn && (targetRank === '8' || targetRank === '1');
  }

  private boardFromFen(fen: string): PieceCode[][] {
    const rows = fen.split(' ')[0]?.split('/') ?? [];
    return rows.map((row) => {
      const result: PieceCode[] = [];
      for (const ch of row) {
        if (Number.isFinite(Number(ch))) {
          const empty = Number(ch);
          for (let i = 0; i < empty; i++) {
            result.push(null);
          }
        } else {
          result.push(ch);
        }
      }
      return result;
    });
  }

  private syncLangFromStorage() {
    const saved = this.safeLocalGet('lang');
    if (saved === 'pl' || saved === 'en') {
      this.lang = saved;
    }
  }

  private safeSessionGet(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private safeSessionSet(key: string, value: string) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
    }
  }

  private safeSessionRemove(key: string) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
    }
  }

  private safeLocalGet(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  t(key: keyof typeof this.translations.en) {
    return this.translations[this.lang][key];
  }

  onlineErrorMessage(code: string | null) {
    if (!code) {
      return '';
    }
    switch (code) {
      case 'room_not_found':
        return 'Room not found.';
      case 'bad_password':
        return 'Wrong password.';
      case 'room_full':
        return 'Room is full.';
      case 'active_game':
        return 'You are already in an active game.';
      case 'room_join_failed':
        return 'Unable to join room.';
      case 'already_in_room':
        return 'You are already in another room.';
      case 'host_cannot_join':
        return 'You are the host of this room.';
      case 'room_create_failed':
      case 'roomCreateFailed':
        return 'Unable to create room.';
      case 'matchmaking_failed':
      case 'matchmakingFailed':
        return 'Matchmaking unavailable.';
      case 'already_queued':
        return this.t('alreadyQueued');
      case 'reconnect_failed':
        return this.t('reconnectFailed');
      case 'reconnect_ack_timeout':
        return this.t('reconnectAckTimeout');
      case 'invalid_reconnect_token':
      case 'invalid_room_reconnect_token':
        return this.t('recoveryFailed');
      case 'invalid_game_snapshot':
        return this.t('invalidGameSnapshot');
      case 'state_conflict':
        return this.t('stateConflict');
      case 'snapshot_recovery_failed':
        return this.t('snapshotRecoveryFailed');
      case 'room_invite_failed':
      case 'roomInviteFailed':
        return 'Unable to create invite.';
      case 'room_kick_failed':
      case 'roomKickFailed':
        return 'Unable to remove player.';
      case 'room_delete_failed':
      case 'roomDeleteFailed':
        return 'Unable to delete room.';
      case 'room_start_failed':
      case 'roomStartFailed':
        return 'Unable to start game.';
      case 'room_in_game':
        return 'Room already in game.';
      case 'roomKicked':
        return this.t('roomKicked');
      case 'room_closed_host_deleted':
        return this.t('roomClosedHostDeleted');
      case 'room_closed_host_left':
        return this.t('roomClosedHostLeft');
      case 'room_closed_host_disconnected':
        return this.t('roomClosedHostDisconnected');
      case 'room_closed_room_expired':
        return this.t('roomClosedRoomExpired');
      case 'room_closed_no_active_participants':
        return this.t('roomClosedNoParticipants');
      case 'roomClosed':
        return this.t('roomClosed');
      case 'roomDeleted':
        return this.t('roomDeleted');
      case 'draw_offer_limit':
        return 'Draw offer limit reached.';
      case 'room_spectate_failed':
      case 'roomSpectateFailed':
        return 'Unable to spectate room.';
      default:
        return this.t('onlineActionFailed');
    }
  }

  isOwnRoom(room: { hostUserId?: number | null }) {
    if (!room || room.hostUserId == null || this.sessionUserId == null) {
      return false;
    }
    return room.hostUserId === this.sessionUserId;
  }

  roomParticipants() {
    return this.multiplayer.roomParticipants$.value ?? [];
  }

  isHostInRoom() {
    const userId = this.sessionUserId;
    if (userId == null) {
      return false;
    }
    return this.multiplayer.roomParticipants$.value.some(
      (p) => (p.role || '').toUpperCase() === 'HOST' && p.userId === userId
    );
  }

  canKickParticipant(participant: { userId?: number | null; role?: string | null }) {
    if (!participant || participant.userId == null) {
      return false;
    }
    const role = (participant.role || '').toUpperCase();
    if (role !== 'PLAYER' && role !== 'SPECTATOR') {
      return false;
    }
    return this.isHostInRoom() && participant.userId !== this.sessionUserId;
  }

  hasPendingPlayer() {
    return this.multiplayer.roomParticipants$.value.some(
      (p) => (p.role || '').toUpperCase() === 'PLAYER' && (p.status || '').toUpperCase() !== 'LEFT'
    );
  }

  private isPlayerInRoom() {
    const userId = this.sessionUserId;
    if (userId == null) {
      return false;
    }
    return this.multiplayer.roomParticipants$.value.some(
      (p) =>
        (p.role || '').toUpperCase() === 'PLAYER' &&
        (p.status || '').toUpperCase() !== 'LEFT' &&
        p.userId === userId
    );
  }

  isActiveRoom(roomCode: string) {
    const active = this.multiplayer.activeRoomCode$.value;
    if (!active) {
      return false;
    }
    return active.toUpperCase() === roomCode.toUpperCase();
  }

  hasActiveRoom() {
    return !!this.multiplayer.activeRoomCode$.value;
  }

  roomVisibilityLabel() {
    const code = this.multiplayer.activeRoomCode$.value || this.multiplayer.roomCode$.value;
    if (!code) {
      return '';
    }
    const match = this.multiplayer.publicRooms$.value.find(
      (room) => room.roomCode.toUpperCase() === code.toUpperCase()
    );
    return match ? this.t('roomPublic') : this.t('roomPrivate');
  }

  multiplayerGameActive() {
    return this.onlineMode && !!this.multiplayer.gameState$.value?.gameId;
  }

  connectionStatusLabel() {
    switch (this.multiplayer.connectionState$.value) {
      case 'CONNECTING': return this.t('connecting');
      case 'AUTHENTICATING': return this.t('authenticating');
      case 'RECONNECTING': return this.t('reconnecting');
      case 'RECOVERING_GAME': return this.t('recoveringGame');
      case 'ERROR': return this.t('recoveryFailed');
      case 'READY': return this.t('connected');
      default: return this.t('disconnected');
    }
  }

  showOnlineBoardStatus() {
    return this.multiplayer.connectionState$.value !== 'READY'
      || this.multiplayer.queueState$.value === 'QUEUED'
      || !!this.multiplayer.activeRoomCode$.value;
  }

  multiplayerOutcome() {
    const game = this.multiplayer.gameState$.value;
    return game ? toMultiplayerOutcome(game, this.multiplayer.yourColor$.value) : null;
  }

  reviewMultiplayerGame(outcome: GameOutcome) {
    this.multiplayerReviewedGameId = outcome.gameId;
    if (typeof document !== 'undefined') {
      window.setTimeout(() => document.getElementById('multiplayer-review-history')?.focus(), 0);
    }
  }

  isReviewingMultiplayerGame() {
    return !!this.multiplayerReviewedGameId
      && this.multiplayer.gameState$.value?.gameId === this.multiplayerReviewedGameId;
  }

  multiplayerTurnLabel() {
    const game = this.multiplayer.gameState$.value;
    if (!game) return '';
    if (game.result !== 'ONGOING') return this.t('gameFinished');
    if (this.multiplayer.connectionState$.value !== 'READY') return this.connectionStatusLabel();
    if (this.multiplayer.opponentDisconnected$.value) return this.t('opponentDisconnected');
    const yourColor = this.multiplayer.yourColor$.value;
    const turn = !yourColor ? this.t('spectator')
      : yourColor === game.sideToMove ? this.t('yourTurn') : this.t('opponentTurn');
    const status = `${this.t('gameInProgress')} · ${turn}`;
    return this.state.positionStatus$.value === 'CHECK'
      ? `${this.t('checkAlert')} · ${status}` : status;
  }

  private buildMultiplayerHistory(game: GameStateSyncDto): MoveView[] {
    const replay = new Chess();
    return game.moves.map((move) => {
      const applied = replay.move({
        from: move.from as Square,
        to: move.to as Square,
        promotion: (move.promotion ?? undefined) as 'q' | 'r' | 'b' | 'n' | undefined
      });
      return {
        san: applied.san,
        from: applied.from,
        to: applied.to,
        promotion: applied.promotion
      };
    });
  }

  chessArenaState(): ChessArenaState {
    const connection = this.multiplayer.connectionState$.value;
    if (connection === 'RECONNECTING' || connection === 'RECOVERING_GAME') return 'RECONNECTING';
    if (this.multiplayer.matchFound$.value) return 'MATCH_FOUND';
    if (this.multiplayer.gameState$.value?.gameId) return 'ACTIVE_GAME';
    if (this.multiplayer.queueState$.value === 'QUEUED') return 'WAITING_FOR_OPPONENT';
    return 'LOBBY';
  }

  isSpectator() {
    return this.onlineMode && !this.multiplayer.yourColor$.value && !!this.multiplayer.gameState$.value?.gameId;
  }

  colorLabel(color: 'w' | 'b') {
    return color === 'w' ? this.t('white') : this.t('black');
  }

  syncAnalysisSetting() {
    if (this.botMode && !this.botGameActive) {
      this.analysis.enabled$.next(false);
      this.analysis.stop();
      return;
    }
    this.analysis.enabled$.next(this.analysisEnabled);
    if (this.analysisEnabled) {
      this.analysis.useLocalAnalysis();
      this.analysis.scheduleAnalyze(this.state.fen$.value);
    } else {
      this.analysis.stop();
    }
  }

  isBotThinking(): boolean {
    return this.botMode && this.botThinking;
  }

  isGameFinished(): boolean {
    return this.botMode ? this.botOutcome() !== null : this.state.isGameOver();
  }

  botOutcome(): GameOutcome | null {
    if (!this.botMode || !this.botGameActive) return null;
    if (this.botExecution === 'server') return this.serverGame ? serverOutcome(this.serverGame) : null;
    return this.state.outcome(this.playerColor === 'w' ? 'WHITE' : 'BLACK', this.botResigned);
  }

  outcomeKey(outcome: GameOutcome): string {
    return `${outcome.gameId}:${outcome.result}:${outcome.moveCount}`;
  }

  reviewBotGame(outcome: GameOutcome) {
    this.dismissedOutcomeKey = this.outcomeKey(outcome);
    this.botSidebarTab = 'moves';
  }

  canHumanMove(): boolean {
    if (this.pendingServerMove) return false;
    if (this.botMode) {
      return this.botGameActive && !this.isBotThinking() && !this.isGameFinished()
        && this.state.sideToMove$.value === this.playerColor;
    }
    if (this.onlineMode) {
      const game = this.multiplayer.gameState$.value;
      return !!game?.gameId
        && game.result === 'ONGOING'
        && !!this.multiplayer.yourColor$.value
        && this.multiplayer.yourColor$.value === game.sideToMove
        && this.multiplayer.connectionState$.value === 'READY';
    }
    return !this.state.isGameOver();
  }

  setBotExecution(execution: 'browser' | 'server') {
    if (this.botExecution === execution) return;
    this.invalidateBotSession();
    this.botExecution = execution;
    if (execution === 'server') void this.engineApi.validateSession().then(() => this.cdr.markForCheck());
    if (execution === 'browser') void this.botEngine.warm(this.botEngineFlavor).catch(error => {
      if (!this.destroyed) this.setBotError('engine', error.message);
    });
  }

  setBotEngineFlavor(flavor: 'lite' | 'full') {
    if (this.botEngineFlavor === flavor) return;
    this.invalidateBotSession();
    this.botEngineFlavor = flavor;
    if (this.botExecution === 'browser') void this.botEngine.warm(flavor).catch(error => {
      if (!this.destroyed) this.setBotError('engine', error.message);
    });
  }

  private invalidateBotSession() {
    this.botEpoch++;
    if (this.serverTurnPoll !== null) window.clearTimeout(this.serverTurnPoll);
    this.serverTurnPoll = null;
    this.botEngine.stop();
    this.botThinking = false;
    this.pendingServerMove = false;
    this.pendingPromotion = null;
  }

  sendChatMessage() {
    const roomCode = this.multiplayer.activeRoomCode$.value;
    const text = this.chatMessage.trim();
    if (!roomCode || !text) {
      return;
    }
    this.multiplayer.sendRoomMessage(roomCode, text);
    this.chatMessage = '';
  }

  private runOnlineAction(action: () => void) {
    if (this.multiplayer.ready$.value) {
      action();
      return;
    }
    this.pendingOnlineAction = action;
    if (this.multiplayer.connectionState$.value === 'DISCONNECTED'
        || this.multiplayer.connectionState$.value === 'ERROR') {
      this.connectOnline();
    }
  }

  setOnlineView(view: 'public' | 'create' | 'join' | 'manage') {
    this.onlineView = view;
    this.multiplayer.clearLastError();
  }

  onOnlineTabKeydown(event: KeyboardEvent) {
    const tabs: Array<typeof this.onlineView> = ['public', 'create', 'join', 'manage'];
    const index = tabs.indexOf(this.onlineView);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    this.setOnlineView(tabs[next]);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  private parseEvalValue(raw: string | null | undefined) {
    if (!raw) {
      return null;
    }
    const trimmed = String(raw).trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith('M')) {
      const mateValue = Number(trimmed.slice(1));
      if (Number.isNaN(mateValue)) {
        return null;
      }
      return mateValue > 0 ? 10 : -10;
    }
    const numeric = Number(trimmed);
    if (Number.isNaN(numeric)) {
      return null;
    }
    return Math.max(-10, Math.min(10, numeric));
  }

  botStrengthLabel() {
    return this.botMaximum ? 'MAXIMUM' : this.validStrengthTarget() ? strengthCategory(this.botElo) : 'Invalid target';
  }

  validStrengthTarget() {
    return Number.isInteger(this.botElo) && this.botElo >= 200 && this.botElo <= 3190
      && (this.botExecution === 'browser' || this.serverMode !== 'TRAINING' || this.botElo >= 1320)
      && (this.botExecution === 'browser' || this.serverMode !== 'BEGINNER' || this.botElo <= 1319);
  }

  engineStatusLabel() {
    if (this.botExecution === 'browser') {
      return this.botThinking ? this.t('botThinking') : this.t('botReady');
    }
    switch (this.serverGame?.turnState) {
      case 'ENGINE_THINKING': return this.t('botThinking');
      case 'ENGINE_FAILED': return this.botError || this.serverGame.engineError || 'Engine failed';
      case 'PLAYER_TURN': return this.t('botReady');
      case 'FINISHED': return this.t('gameOver');
      default: return this.botThinking ? this.t('engineLoading') : this.t('botReady');
    }
  }
}

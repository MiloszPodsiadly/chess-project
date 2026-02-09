import { Component, DestroyRef, ChangeDetectorRef } from '@angular/core';
import { AsyncPipe, NgForOf, NgIf, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameStateService } from './game-state.service';
import { MultiplayerService } from '../multiplayer/multiplayer.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EngineAnalysisService } from '../analysis/engine-analysis.service';
import { BoardComponent } from './board/board.component';
import { MoveHistoryComponent } from './move-history/move-history.component';
import { GameControlsComponent } from './game-controls/game-controls.component';
import { AnalysisPanelComponent } from '../analysis/analysis-panel.component';
import { BotEngineService } from '../bot/bot-engine.service';
import { ActivatedRoute } from '@angular/router';
import { TimeControlType } from '../multiplayer/models';
import { EngineConfigMapper } from '../bot/engine-config-mapper';
import { combineLatest } from 'rxjs';

type PieceCode = string | null;

@Component({
  selector: 'app-game-page',
  standalone: true,
  imports: [AsyncPipe, NgIf, NgForOf, DatePipe, FormsModule, BoardComponent, MoveHistoryComponent, GameControlsComponent, AnalysisPanelComponent],
  templateUrl: './game.page.html',
  styleUrl: './game.page.css'
})
export class GamePageComponent {
  pendingPromotion: { from: string; to: string } | null = null;
  promotionOptions = ['q', 'r', 'b', 'n'];
  botEnabled = false;
  botElo = 1200;
  botColor: 'w' | 'b' = 'b';
  botSideChoice: 'w' | 'b' | 'random' = 'b';
  playerColor: 'w' | 'b' = 'w';
  botGameActive = false;
  botMode = false;
  botThinking = false;
  showBotSetup = false;
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
  private pendingOnlineTimer: number | null = null;
  showOnlineSetup = false;
  onlineUsername = '';
  onlineReconnect = '';
  onlineTimeControl: TimeControlType = 'RAPID';
  onlineRoomCode = '';
  lang: 'en' | 'pl' = 'en';
  multiplayerActive = false;
  pendingServerMove = false;
  displayWhiteMs: number | null = null;
  displayBlackMs: number | null = null;
  clockTimer: number | null = null;
  private onlineAutoConnected = false;
  sessionUsername: string | null = null;
  private destroyed = false;

  readonly translations = {
    en: {
      localGame: 'Local Game',
      subtitle: 'Engine-powered bot, analysis, and FIDE rules',
      onlineSetup: 'Online setup',
      onlineSetupSubtitle: 'Create a room or join instantly',
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
      chatSubtitleEmpty: 'Join a room to chat.',
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
      resultWin: 'You win',
      resultLoss: 'You lose',
      resultDraw: 'Draw',
      endCheckmate: 'Checkmate',
      endResign: 'Resignation',
      endTimeout: 'Time out',
      endStalemate: 'Stalemate',
      endAgreement: 'Agreed draw',
      endRepetition: 'Threefold repetition',
      endFifty: 'Fifty-move rule',
      endInsufficient: 'Insufficient material',
      connect: 'Connect',
      connected: 'Connected',
      disconnected: 'Disconnected',
      createRoom: 'Create room',
      joinRoom: 'Join room',
      matchmaking: 'Matchmaking',
      skip: 'Skip',
      botSetup: 'Bot setup',
      botSetupSubtitle: 'Configure strength, color, and analysis',
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
      onlineWaitTitle: 'Waiting for game',
      onlineWaitSubtitle: 'Create or join a room to start playing.',
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
      localGame: 'Gra lokalna',
      subtitle: 'Bot, analiza i zasady FIDE',
      onlineSetup: 'Ustawienia online',
      onlineSetupSubtitle: 'Utworz pokoj lub dolacz od razu',
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
      chatSubtitleEmpty: 'Dolacz do pokoju, aby pisac.',
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
      resultWin: 'Wygrales',
      resultLoss: 'Przegrales',
      resultDraw: 'Remis',
      endCheckmate: 'Mat',
      endResign: 'Poddanie',
      endTimeout: 'Czas',
      endStalemate: 'Pat',
      endAgreement: 'Remis zgodny',
      endRepetition: 'Trzykrotne powtorzenie',
      endFifty: 'Regula 50 ruchow',
      endInsufficient: 'Niewystarczajacy material',
      connect: 'Polacz',
      connected: 'Polaczono',
      disconnected: 'Brak polaczenia',
      createRoom: 'Utworz pokoj',
      joinRoom: 'Dolacz do pokoju',
      matchmaking: 'Matchmaking',
      skip: 'Pomin',
      botSetup: 'Ustawienia bota',
      botSetupSubtitle: 'Ustaw sile, kolor i analize',
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
      onlineWaitTitle: 'Czekamy na gre',
      onlineWaitSubtitle: 'Utworz lub dolacz do pokoju.',
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
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
    destroyRef: DestroyRef
  ) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.clockTimer) {
        window.clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
    });
    this.multiplayer.gameState$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((game) => {
        this.multiplayerActive = !!game?.gameId;
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
          return;
        }
        this.state.loadExternalState(
          game.fen,
          game.moves.map((m) => ({
            san: `${m.from}-${m.to}${m.promotion ? `=${m.promotion}` : ''}`,
            from: m.from,
            to: m.to,
            promotion: m.promotion ?? undefined
          })),
          game.sideToMove === 'WHITE' ? 'w' : 'b'
        );
        this.pendingServerMove = false;
        if (game.analysis) {
          this.analysis.applyExternalAnalysis(game.analysis);
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
          if (this.pendingOnlineTimer) {
            window.clearTimeout(this.pendingOnlineTimer);
            this.pendingOnlineTimer = null;
          }
          action();
        }
      });

    this.multiplayer.connected$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((connected) => {
        if (!connected) {
          this.pendingServerMove = false;
        }
        if (!connected || !this.pendingOnlineAction) {
          return;
        }
        const action = this.pendingOnlineAction;
        this.pendingOnlineAction = null;
        if (this.pendingOnlineTimer) {
          window.clearTimeout(this.pendingOnlineTimer);
          this.pendingOnlineTimer = null;
        }
        window.setTimeout(() => action(), 300);
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

    this.multiplayer.reconnectToken$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((token) => {
        if (token) {
          this.onlineReconnect = token;
          this.safeSessionSet('onlineReconnect', token);
        }
      });

    this.multiplayer.lastError$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => {
        this.pendingServerMove = false;
      });

    combineLatest([this.analysis.evaluation$, this.state.moves$, this.analysis.enabled$])
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(([evaluation, moves, enabled]) => {
        if (!enabled) {
          return;
        }
        const value = this.parseEvalValue(evaluation);
        if (value == null) {
          return;
        }
        const index = moves.length;
        this.evalHistory[index] = value;
        if (this.evalHistory.length > index + 1) {
          this.evalHistory = this.evalHistory.slice(0, index + 1);
        }
      });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((params) => {
        const mode = params.get('mode');
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
          this.safeSessionRemove('onlineUsername');
          this.safeSessionRemove('onlineReconnect');
          this.onlineUsername = '';
          this.onlineReconnect = '';
          this.botGameActive = false;
          this.botEnabled = false;
          this.analysis.stop();
          this.evalHistory = [];
        } else {
          this.botGameActive = false;
          this.botEnabled = false;
        }
        if (this.onlineMode) {
          this.ensureOnlineConnected();
        }
      });
    this.syncLangFromStorage();
    window.addEventListener('storage', (event) => {
      if (event.key === 'lang') {
        this.syncLangFromStorage();
      }
    });
  }

  onSquareClick(square: string) {
    if (this.isBoardLocked()) {
      return;
    }
    if (this.pendingServerMove) {
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
      const yourColor = this.multiplayer.yourColor$.value;
      const sideToMove = this.multiplayer.gameState$.value?.sideToMove;
      if (!yourColor || !sideToMove || yourColor !== sideToMove) {
        return;
      }
      this.pendingServerMove = true;
      this.state.clearSelection();
      this.multiplayer.makeMove(multiplayerGameId, {
        from: selected,
        to: square
      });
      return;
    }
    const moved = this.state.attemptMove(selected, square);
    if (moved) {
      this.analysis.scheduleAnalyze(this.state.fen$.value);
      this.maybeBotMove();
    }
  }

  choosePromotion(piece: string) {
    if (!this.pendingPromotion) {
      return;
    }
    if (this.isBoardLocked()) {
      return;
    }
    if (this.pendingServerMove) {
      return;
    }
    const multiplayerGameId = this.multiplayer.gameState$.value?.gameId;
    if (multiplayerGameId) {
      const yourColor = this.multiplayer.yourColor$.value;
      const sideToMove = this.multiplayer.gameState$.value?.sideToMove;
      if (!yourColor || !sideToMove || yourColor !== sideToMove) {
        return;
      }
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
    const moved = this.state.attemptMove(this.pendingPromotion.from, this.pendingPromotion.to, piece);
    if (moved) {
      this.analysis.scheduleAnalyze(this.state.fen$.value);
      this.maybeBotMove();
    }
    this.pendingPromotion = null;
  }

  async maybeBotMove() {
    if (!this.botEnabled || this.multiplayer.gameState$.value?.gameId) {
      return;
    }
    if (this.state.sideToMove$.value !== this.botColor) {
      return;
    }
    if (this.botThinking) {
      return;
    }
    this.botThinking = true;
    const move = await this.botEngine.getMove(this.state.fen$.value, this.botElo);
    if (!move || move.length < 4) {
      this.botThinking = false;
      return;
    }
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move.length > 4 ? move[4] : undefined;
    const moved = this.state.attemptMove(from, to, promotion);
    if (moved) {
      this.analysis.scheduleAnalyze(this.state.fen$.value);
    }
    this.botThinking = false;
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

  startBotGame() {
    if (this.multiplayer.connected$.value || this.onlineMode) {
      this.disconnectOnlineSession();
    }
    const chosen =
      this.botSideChoice === 'random'
        ? Math.random() > 0.5
          ? 'w'
          : 'b'
        : this.botSideChoice;
    this.botColor = chosen;
    this.playerColor = chosen === 'w' ? 'b' : 'w';
    this.botEnabled = true;
    this.botGameActive = true;
    this.showBotSetup = false;
    this.state.reset();
    this.evalHistory = [];
    this.syncAnalysisSetting();
    if (this.botColor === 'w') {
      this.maybeBotMove();
    }
  }

  restartBotGame() {
    if (!this.botMode) {
      return;
    }
    if (this.multiplayer.connected$.value || this.onlineMode) {
      this.disconnectOnlineSession();
    }
    this.botEnabled = true;
    this.botGameActive = true;
    this.showBotSetup = false;
    this.state.reset();
    this.evalHistory = [];
    this.syncAnalysisSetting();
    if (this.botColor === 'w') {
      this.maybeBotMove();
    }
  }

  exitToBotSetup() {
    if (!this.botMode) {
      return;
    }
    this.botEnabled = false;
    this.botGameActive = false;
    this.showBotSetup = true;
    this.state.reset();
    this.evalHistory = [];
    this.analysis.stop();
  }

  connectOnline() {
    const username = this.onlineUsername || this.safeSessionGet('onlineUsername') || undefined;
    const token = this.onlineReconnect || this.safeSessionGet('onlineReconnect') || undefined;
    this.multiplayer.connect(username, token || undefined);
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
    const savedToken = this.safeSessionGet('onlineReconnect');
    if (savedUser && !this.onlineUsername) {
      this.onlineUsername = savedUser;
    }
    if (savedToken && !this.onlineReconnect) {
      this.onlineReconnect = savedToken;
    }
  }

  startOnlineMatchmaking() {
    this.runOnlineAction(() => {
      this.multiplayer.queueMatchmaking(this.onlineTimeControl);
      this.showOnlineSetup = false;
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
        return 'You were removed from the room.';
      case 'roomClosed':
        return 'Room was closed by the host.';
      case 'roomDeleted':
        return 'Room deleted.';
      case 'draw_offer_limit':
        return 'Draw offer limit reached.';
      case 'room_spectate_failed':
      case 'roomSpectateFailed':
        return 'Unable to spectate room.';
      default:
        return code;
    }
  }

  isOwnRoom(room: { hostUsername?: string | null }) {
    if (!room || !room.hostUsername || !this.sessionUsername) {
      return false;
    }
    return room.hostUsername.toLowerCase() === this.sessionUsername.toLowerCase();
  }

  roomParticipants() {
    return this.multiplayer.roomParticipants$.value ?? [];
  }

  isHostInRoom() {
    const username = this.sessionUsername;
    if (!username) {
      return false;
    }
    return this.multiplayer.roomParticipants$.value.some(
      (p) => (p.role || '').toUpperCase() === 'HOST' && (p.username || '').toLowerCase() === username.toLowerCase()
    );
  }

  canKickParticipant(participant: { username?: string | null; role?: string | null }) {
    if (!participant || !participant.username) {
      return false;
    }
    const role = (participant.role || '').toUpperCase();
    if (role !== 'PLAYER' && role !== 'SPECTATOR') {
      return false;
    }
    return this.isHostInRoom() && participant.username.toLowerCase() !== (this.sessionUsername || '').toLowerCase();
  }

  hasPendingPlayer() {
    return this.multiplayer.roomParticipants$.value.some(
      (p) => (p.role || '').toUpperCase() === 'PLAYER' && (p.status || '').toUpperCase() !== 'LEFT'
    );
  }

  private isPlayerInRoom() {
    const username = this.sessionUsername;
    if (!username) {
      return false;
    }
    return this.multiplayer.roomParticipants$.value.some(
      (p) =>
        (p.role || '').toUpperCase() === 'PLAYER' &&
        (p.status || '').toUpperCase() !== 'LEFT' &&
        (p.username || '').toLowerCase() === username.toLowerCase()
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

  isSpectator() {
    return this.onlineMode && !this.multiplayer.yourColor$.value && !!this.multiplayer.gameState$.value?.gameId;
  }

  multiplayerResultTitle() {
    const game = this.multiplayer.gameState$.value;
    if (!game || game.result === 'ONGOING') {
      return '';
    }
    if (game.result === 'DRAW') {
      return this.t('resultDraw');
    }
    const yourColor = this.multiplayer.yourColor$.value;
    if (game.result === 'WHITE_WIN') {
      return yourColor === 'WHITE' ? this.t('resultWin') : this.t('resultLoss');
    }
    if (game.result === 'BLACK_WIN') {
      return yourColor === 'BLACK' ? this.t('resultWin') : this.t('resultLoss');
    }
    return this.t('gameOver');
  }

  multiplayerResultClass(): 'win' | 'loss' | 'draw' | '' {
    const game = this.multiplayer.gameState$.value;
    if (!game || game.result === 'ONGOING') {
      return '';
    }
    if (game.result === 'DRAW') {
      return 'draw';
    }
    const yourColor = this.multiplayer.yourColor$.value;
    if (game.result === 'WHITE_WIN') {
      return yourColor === 'WHITE' ? 'win' : 'loss';
    }
    if (game.result === 'BLACK_WIN') {
      return yourColor === 'BLACK' ? 'win' : 'loss';
    }
    return '';
  }

  multiplayerEndReason() {
    const reason = this.multiplayer.gameState$.value?.endReason;
    switch (reason) {
      case 'CHECKMATE':
        return this.t('endCheckmate');
      case 'RESIGNATION':
        return this.t('endResign');
      case 'TIME_OUT':
        return this.t('endTimeout');
      case 'STALEMATE':
        return this.t('endStalemate');
      case 'AGREED_DRAW':
        return this.t('endAgreement');
      case 'THREEFOLD_REPETITION':
        return this.t('endRepetition');
      case 'FIFTY_MOVE_RULE':
        return this.t('endFifty');
      case 'INSUFFICIENT_MATERIAL':
        return this.t('endInsufficient');
      default:
        return '';
    }
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

  isBoardLocked() {
    if (this.botMode) {
      return !this.botGameActive;
    }
    if (this.onlineMode) {
      return !this.multiplayerActive;
    }
    return false;
  }

  boardLockTitle() {
    if (this.botMode) {
      return this.t('preStartTitle');
    }
    if (this.onlineMode) {
      if (this.multiplayer.gameState$.value?.gameId && !this.multiplayer.yourColor$.value) {
        return this.t('spectator');
      }
      return this.t('onlineWaitTitle');
    }
    return '';
  }

  boardLockSubtitle() {
    if (this.botMode) {
      return this.t('preStartSubtitle');
    }
    if (this.onlineMode) {
      if (this.multiplayer.gameState$.value?.gameId && !this.multiplayer.yourColor$.value) {
        return this.t('onlineWaitSubtitle');
      }
      return this.t('onlineWaitSubtitle');
    }
    return '';
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
    if (this.multiplayer.connected$.value) {
      window.setTimeout(() => action(), 300);
      return;
    }
    this.pendingOnlineAction = action;
    if (this.pendingOnlineTimer) {
      window.clearTimeout(this.pendingOnlineTimer);
    }
    this.connectOnline();
    this.pendingOnlineTimer = window.setTimeout(() => {
      if (this.pendingOnlineAction && this.multiplayer.connected$.value) {
        const pending = this.pendingOnlineAction;
        this.pendingOnlineAction = null;
        this.pendingOnlineTimer = null;
        pending();
      }
    }, 2000);
  }

  showBotResultOverlay() {
    if (!this.botMode || !this.botGameActive) {
      return false;
    }
    return this.isBotGameOver();
  }

  setOnlineView(view: 'public' | 'create' | 'join' | 'manage') {
    this.onlineView = view;
    this.multiplayer.clearLastError();
  }

  private botWinner(): 'player' | 'bot' | null {
    if (!this.isCheckmateStatus()) {
      return null;
    }
    const sideToMove = this.state.sideToMove$.value;
    const winnerColor: 'w' | 'b' = sideToMove === 'w' ? 'b' : 'w';
    return winnerColor === this.playerColor ? 'player' : 'bot';
  }

  botResultTitle() {
    if (this.isDrawStatus()) {
      return this.t('resultDraw');
    }
    const winner = this.botWinner();
    if (winner === 'player') {
      return this.t('youWonTitle');
    }
    if (winner === 'bot') {
      return this.t('botWonTitle');
    }
    return '';
  }

  botResultClass(): 'win' | 'loss' | 'draw' | '' {
    if (this.isDrawStatus()) {
      return 'draw';
    }
    const winner = this.botWinner();
    if (winner === 'player') {
      return 'win';
    }
    if (winner === 'bot') {
      return 'loss';
    }
    return '';
  }

  botResultSubtitle() {
    return this.t('resultSubtitle');
  }

  private isCheckmateStatus() {
    const status = String(this.state.status$.value ?? '').toLowerCase();
    return status.includes('checkmate');
  }

  private isDrawStatus() {
    const status = String(this.state.status$.value ?? '').toLowerCase();
    return status.includes('draw') || status.includes('stalemate') || status.includes('insufficient');
  }

  private isBotGameOver() {
    return this.isCheckmateStatus() || this.isDrawStatus();
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

  botProfile() {
    return EngineConfigMapper.forElo(this.botElo);
  }

  botStrengthLabel() {
    if (this.botElo <= 600) {
      return 'Beginner';
    }
    if (this.botElo <= 1200) {
      return 'Club';
    }
    if (this.botElo <= 1600) {
      return 'Advanced';
    }
    return 'Master';
  }

  botMoveTimeLabel() {
    const profile = this.botProfile();
    if (profile.minTimeMs === profile.maxTimeMs) {
      return `${profile.minTimeMs} ms`;
    }
    return `${profile.minTimeMs}-${profile.maxTimeMs} ms`;
  }

  botBlunderLabel() {
    const profile = this.botProfile();
    return `${Math.round(profile.blunderProb * 100)}%`;
  }
}

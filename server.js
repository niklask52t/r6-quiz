const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay', 'index.html'));
});
app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host', 'index.html'));
});

// Load questions
const questionsPath = path.join(__dirname, 'data', 'questions.json');
let questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));

function buildQuestionPool() {
  const pool = [];
  questionsData.categories.forEach((cat, ci) => {
    cat.questions.forEach((q, qi) => {
      pool.push({ categoryIndex: ci, questionIndex: qi, category: cat.name, ...q });
    });
  });
  return pool;
}

// ---- DEFAULT SETTINGS ----
const defaultSettings = {
  timerDuration: 60,
  totalRounds: 4,
  pointsPerQuestion: 1,
  // Difficulty points multiplier
  difficultyPoints: { easy: 1, medium: 1, hard: 2, expert: 3 },
  // Blitz round settings
  blitzEnabled: true,
  blitzChance: 20,          // % chance per question
  blitzTimer: 15,            // seconds
  blitzPointsMultiplier: 2,  // bonus multiplier
  // Hardcore round settings
  hardcoreEnabled: true,
  hardcoreChance: 10,        // % chance per question
  hardcorePointsMultiplier: 3,
  // Steal round settings
  stealEnabled: true,
  stealChance: 10,           // % chance
  // Fair difficulty distribution
  fairDifficulty: true,
};

// ---- GAME STATE ----
let settings = { ...defaultSettings };

let gameState = {
  screen: 'intro',
  players: [],
  currentQuestion: null,
  currentQuestionIndex: -1,
  currentCategory: null,
  selectedPlayer: null,
  selectedAnswer: -1,
  revealedAnswer: false,
  usedQuestions: [],
  questionNumber: 0,
  phase: 'idle',            // idle | playerSelect | specialIntro | answering | revealed | stealing
  timerRemaining: 0,
  timerActive: false,
  lastPlayerId: null,
  hiddenAnswers: [],
  doubleActive: false,
  currentRound: 1,
  // Special round state
  specialType: null,         // null | 'blitz' | 'hardcore' | 'steal'
  stealPlayer: null,         // who can steal
  stealActive: false,
  stealPending: false,       // true = answer not yet fully revealed (hide correct for steal)
  risikoActive: false,       // risiko joker active
  // Difficulty tracking per player: { playerId: { easy: N, medium: N, hard: N, expert: N } }
  difficultyTracker: {},
  // Special tracking per player: { playerId: { blitz: N, hardcore: N, steal: N } }
  specialTracker: {},
  // History
  history: [],
  // Quiz started flag (locks settings)
  quizStarted: false,
  // Game over flag
  gameOver: false,
};

let timerInterval = null;

app.get('/api/questions', (req, res) => {
  res.json(questionsData);
});

// ---- TIMER ----
function startTimer(duration) {
  stopTimer();
  const d = duration || settings.timerDuration;
  gameState.timerRemaining = d;
  gameState.timerActive = true;
  io.emit('stateUpdate', sanitizeState());

  timerInterval = setInterval(() => {
    gameState.timerRemaining--;
    io.emit('timerTick', gameState.timerRemaining);

    if (gameState.timerRemaining <= 0) {
      stopTimer();
      if (gameState.phase === 'answering') {
        handleTimeout();
      }
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState.timerActive = false;
}

function handleTimeout() {
  gameState.selectedAnswer = -1;
  gameState.screen = 'reveal';
  gameState.phase = 'revealed';

  const isSteal = gameState.specialType === 'steal' && gameState.players.length > 1;

  // For steal rounds: DON'T reveal the correct answer yet
  gameState.revealedAnswer = !isSteal;
  gameState.stealPending = isSteal;

  const correctText = gameState.currentQuestion.answers[gameState.currentQuestion.correct];

  // Risiko penalty on timeout too
  let risikoLost = 0;
  if (gameState.risikoActive && gameState.selectedPlayer) {
    const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
    if (player) {
      risikoLost = Math.floor(player.score / 2);
      player.score -= risikoLost;
      gameState.selectedPlayer = { ...player };
    }
  }

  const gameOver = checkGameOver();
  addHistory(gameState.selectedPlayer, false, true, correctText);

  io.emit('answerResult', {
    chosenAnswer: -1,
    correctAnswer: isSteal ? -1 : gameState.currentQuestion.correct,
    correctAnswerText: isSteal ? '???' : correctText,
    isCorrect: false,
    timedOut: true,
    player: gameState.selectedPlayer,
    specialType: gameState.specialType,
    risikoActive: gameState.risikoActive,
    risikoLost,
    stealPending: isSteal,
  });
  io.emit('stateUpdate', sanitizeState());

  if (isSteal) {
    setTimeout(() => offerSteal(gameOver), 2500);
    return;
  }

  autoAdvance(gameOver);
}

function autoAdvance(gameOver) {
  setTimeout(() => {
    if (gameState.phase === 'revealed' || gameState.phase === 'stealing') {
      gameState.screen = 'scoreboard';
      gameState.phase = 'idle';
      gameState.specialType = null;
      gameState.stealActive = false;
      gameState.stealPlayer = null;
      io.emit('stateUpdate', sanitizeState());

      if (gameOver) {
        gameState.gameOver = true;
        setTimeout(() => {
          gameState.screen = 'finale';
          io.emit('stateUpdate', sanitizeState());
        }, 4000);
      }
    }
  }, 4000);
}

// ---- STEAL MECHANIC ----
function offerSteal(gameOver) {
  if (gameState.players.length < 2) { autoAdvance(gameOver); return; }

  // Pick a random other player to steal
  const others = gameState.players.filter(p => p.id !== gameState.selectedPlayer.id);
  const stealer = others[Math.floor(Math.random() * others.length)];

  gameState.stealPlayer = { ...stealer };
  gameState.stealActive = true;
  gameState.phase = 'stealing';

  io.emit('stealOffer', { player: stealer, question: gameState.currentQuestion });
  io.emit('stateUpdate', sanitizeState());

  // Auto-timeout steal after 10s — reveal answer on timeout
  setTimeout(() => {
    if (gameState.phase === 'stealing') {
      gameState.stealActive = false;
      gameState.stealPending = false;
      gameState.revealedAnswer = true;
      gameState.phase = 'revealed';
      const correctText = gameState.currentQuestion.answers[gameState.currentQuestion.correct];
      io.emit('stealResult', {
        success: false, player: stealer, timedOut: true,
        correctAnswer: gameState.currentQuestion.correct,
        correctAnswerText: correctText,
      });
      io.emit('stateUpdate', sanitizeState());
      autoAdvance(gameOver);
    }
  }, 10000);
}

// ---- HISTORY ----
function addHistory(player, isCorrect, timedOut, correctAnswer, stolen) {
  gameState.history.push({
    questionNumber: gameState.questionNumber,
    category: gameState.currentCategory,
    player: player ? player.name : '?',
    difficulty: gameState.currentQuestion ? gameState.currentQuestion.difficulty : '?',
    isCorrect,
    timedOut: timedOut || false,
    correctAnswer: correctAnswer || '',
    specialType: gameState.specialType,
    stolen: stolen || false,
    timestamp: Date.now(),
  });
}

// ---- CHECK GAME OVER ----
function checkGameOver() {
  if (gameState.players.length === 0) return false;
  const allPlayed = gameState.players.every(p => p.playCount >= gameState.currentRound);
  if (allPlayed) {
    if (gameState.currentRound >= settings.totalRounds) return true;
    gameState.currentRound++;
  }
  return false;
}

// ---- FAIR PLAYER ROTATION ----
function pickNextPlayer() {
  const players = gameState.players;
  if (players.length === 0) return null;
  if (players.length === 1) return players[0];

  const minCount = Math.min(...players.map(p => p.playCount));
  let eligible = players.filter(p => p.playCount === minCount && p.id !== gameState.lastPlayerId);
  if (eligible.length === 0) eligible = players.filter(p => p.playCount === minCount);
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// ---- FAIR DIFFICULTY QUESTION PICKER ----
function pickQuestion(forPlayer) {
  const pool = buildQuestionPool();
  const unused = pool.filter(q => !gameState.usedQuestions.includes(`${q.categoryIndex}-${q.questionIndex}`));
  if (unused.length === 0) return null;

  if (!settings.fairDifficulty || !forPlayer) {
    return unused[Math.floor(Math.random() * unused.length)];
  }

  // Get this player's difficulty history
  const tracker = gameState.difficultyTracker[forPlayer.id] || { easy: 0, medium: 0, hard: 0, expert: 0 };

  // Find the difficulty that this player has the LEAST of
  const diffs = ['easy', 'medium', 'hard', 'expert'];
  const minDiffCount = Math.min(...diffs.map(d => tracker[d] || 0));

  // Prefer difficulties the player has least of
  const underrepresented = diffs.filter(d => (tracker[d] || 0) === minDiffCount);

  // Try to find questions in underrepresented difficulties
  let candidates = unused.filter(q => underrepresented.includes(q.difficulty));
  if (candidates.length === 0) candidates = unused;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---- PICK SPECIAL ROUND TYPE (fair per player) ----
function rollSpecialType(player) {
  if (!player) return null;

  const pid = player.id;
  if (!gameState.specialTracker[pid]) {
    gameState.specialTracker[pid] = { blitz: 0, hardcore: 0, steal: 0, total: 0 };
  }

  const myTracker = gameState.specialTracker[pid];

  // Check if this player has FEWER total specials than others
  // If they have more, skip to keep it fair
  const allTotals = gameState.players.map(p => {
    const t = gameState.specialTracker[p.id];
    return t ? t.total : 0;
  });
  const minTotal = Math.min(...allTotals);
  const maxTotal = Math.max(...allTotals);

  // If this player already has more specials than the minimum, reduce chance
  // (only allow if they're at the minimum)
  if (myTracker.total > minTotal && maxTotal > minTotal) {
    return null;
  }

  const roll = Math.random() * 100;
  let threshold = 0;

  if (settings.blitzEnabled) {
    threshold += settings.blitzChance;
    if (roll < threshold) return 'blitz';
  }
  if (settings.hardcoreEnabled) {
    threshold += settings.hardcoreChance;
    if (roll < threshold) return 'hardcore';
  }
  if (settings.stealEnabled) {
    threshold += settings.stealChance;
    if (roll < threshold) return 'steal';
  }
  return null;
}

function trackSpecial(player, type) {
  if (!player || !type) return;
  const pid = player.id;
  if (!gameState.specialTracker[pid]) {
    gameState.specialTracker[pid] = { blitz: 0, hardcore: 0, steal: 0, total: 0 };
  }
  gameState.specialTracker[pid][type] = (gameState.specialTracker[pid][type] || 0) + 1;
  gameState.specialTracker[pid].total = (gameState.specialTracker[pid].total || 0) + 1;
}

// Pick a hardcore question (expert only, or hardest available)
function pickHardcoreQuestion() {
  const pool = buildQuestionPool();
  const unused = pool.filter(q => !gameState.usedQuestions.includes(`${q.categoryIndex}-${q.questionIndex}`));
  if (unused.length === 0) return null;

  let candidates = unused.filter(q => q.difficulty === 'expert');
  if (candidates.length === 0) candidates = unused.filter(q => q.difficulty === 'hard');
  if (candidates.length === 0) candidates = unused;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---- ACTIVATE QUESTION ----
function activateQuestion(q, specialType) {
  gameState.questionNumber++;
  gameState.currentCategory = q.category;
  gameState.currentQuestion = {
    question: q.question,
    image: q.image,
    answers: q.answers,
    correct: q.correct,
    difficulty: q.difficulty,
  };
  gameState.currentQuestionIndex = q.questionIndex;
  gameState.screen = 'question';
  gameState.phase = 'answering';
  gameState.selectedAnswer = -1;
  gameState.revealedAnswer = false;
  gameState.hiddenAnswers = [];
  gameState.doubleActive = false;
  gameState.risikoActive = false;
  gameState.specialType = specialType || null;
  gameState.stealActive = false;
  gameState.stealPlayer = null;

  const key = `${q.categoryIndex}-${q.questionIndex}`;
  if (!gameState.usedQuestions.includes(key)) {
    gameState.usedQuestions.push(key);
  }

  // Track difficulty per player
  if (gameState.selectedPlayer) {
    const pid = gameState.selectedPlayer.id;
    if (!gameState.difficultyTracker[pid]) {
      gameState.difficultyTracker[pid] = { easy: 0, medium: 0, hard: 0, expert: 0 };
    }
    gameState.difficultyTracker[pid][q.difficulty] = (gameState.difficultyTracker[pid][q.difficulty] || 0) + 1;
  }

  delete gameState._pendingQuestion;
  delete gameState._pendingSpecial;
  io.emit('stateUpdate', sanitizeState());

  // Timer: blitz = short, others = normal
  const timerDur = specialType === 'blitz' ? settings.blitzTimer : settings.timerDuration;
  startTimer(timerDur);
}

// ---- CALCULATE POINTS ----
function calculatePoints(question, specialType) {
  let pts = settings.pointsPerQuestion;

  // Difficulty multiplier
  const diffMult = settings.difficultyPoints[question.difficulty] || 1;
  pts *= diffMult;

  // Special round multiplier
  if (specialType === 'blitz') pts *= settings.blitzPointsMultiplier;
  if (specialType === 'hardcore') pts *= settings.hardcorePointsMultiplier;

  // Double joker
  if (gameState.doubleActive) pts *= 2;

  // Risiko joker — triple points
  if (gameState.risikoActive) pts *= 3;

  return Math.round(pts);
}

// ---- SANITIZE STATE (remove internal fields) ----
function sanitizeState() {
  const s = { ...gameState, settings };
  delete s._pendingQuestion;
  delete s._pendingSpecial;
  return s;
}

// ====================================================
// SOCKET.IO
// ====================================================
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.emit('stateUpdate', sanitizeState());
  socket.emit('questionsData', questionsData);

  // ---- Screen control ----
  socket.on('setScreen', (screen) => {
    gameState.screen = screen;
    io.emit('stateUpdate', sanitizeState());
  });

  // ---- Add player ----
  socket.on('addPlayer', (name) => {
    const player = {
      id: Date.now().toString(),
      name: name,
      score: 0,
      playCount: 0,
      jokers: { fiftyFifty: true, skip: true, doublePts: true, risiko: true },
    };
    gameState.players.push(player);
    gameState.difficultyTracker[player.id] = { easy: 0, medium: 0, hard: 0, expert: 0 };
    io.emit('stateUpdate', sanitizeState());
  });

  // ---- Remove player ----
  socket.on('removePlayer', (playerId) => {
    gameState.players = gameState.players.filter(p => p.id !== playerId);
    delete gameState.difficultyTracker[playerId];
    io.emit('stateUpdate', sanitizeState());
  });

  // ============================================
  // COUNTDOWN (before first round)
  // ============================================
  socket.on('startCountdown', () => {
    if (gameState.phase === 'countdown') return;
    gameState.screen = 'countdown';
    gameState.phase = 'countdown';
    gameState.quizStarted = true;
    io.emit('stateUpdate', sanitizeState());
    io.emit('startCountdown');

    // After countdown animation (~6s), auto-trigger first round
    setTimeout(() => {
      if (gameState.phase === 'countdown') {
        // Emit nextRound internally
        if (gameState.players.length === 0) return;
        const player = pickNextPlayer();
        player.playCount++;
        gameState.selectedPlayer = { ...player };
        gameState.lastPlayerId = player.id;
        gameState.screen = 'playerSelect';
        gameState.phase = 'playerSelect';
        gameState.selectedAnswer = -1;
        gameState.revealedAnswer = false;
        gameState.hiddenAnswers = [];
        gameState.doubleActive = false;
        gameState.specialType = null;

        const specialType = rollSpecialType(player);
        if (specialType) trackSpecial(player, specialType);

        let question;
        if (specialType === 'hardcore') {
          question = pickHardcoreQuestion();
        } else {
          question = pickQuestion(player);
        }
        if (!question) { io.emit('allQuestionsUsed'); return; }

        gameState._pendingQuestion = question;
        gameState._pendingSpecial = specialType;

        io.emit('stateUpdate', sanitizeState());
        io.emit('playerSelected', {
          player: gameState.selectedPlayer,
          animate: gameState.players.length > 1,
          allPlayers: gameState.players,
        });

        const rouletteDelay = gameState.players.length > 1 ? 3800 : 1500;

        if (specialType) {
          setTimeout(() => {
            gameState.screen = 'specialIntro';
            gameState.phase = 'specialIntro';
            gameState.specialType = specialType;
            io.emit('stateUpdate', sanitizeState());
            io.emit('specialRound', { type: specialType, player: gameState.selectedPlayer });
          }, rouletteDelay);
          setTimeout(() => {
            const q = gameState._pendingQuestion;
            if (!q) return;
            activateQuestion(q, specialType);
          }, rouletteDelay + 3000);
        } else {
          setTimeout(() => {
            const q = gameState._pendingQuestion;
            if (!q) return;
            activateQuestion(q, null);
          }, rouletteDelay);
        }
      }
    }, 6000);
  });

  // ============================================
  // NEXT ROUND (auto mode)
  // ============================================
  socket.on('nextRound', () => {
    if (gameState.players.length === 0) return;
    if (gameState.phase !== 'idle' && gameState.phase !== 'revealed') return;

    const allPlayed = gameState.players.every(p => p.playCount >= settings.totalRounds);
    if (allPlayed) {
      gameState.screen = 'finale';
      io.emit('stateUpdate', sanitizeState());
      return;
    }

    stopTimer();

    const player = pickNextPlayer();
    player.playCount++;
    gameState.selectedPlayer = { ...player };
    gameState.lastPlayerId = player.id;
    gameState.screen = 'playerSelect';
    gameState.phase = 'playerSelect';
    gameState.selectedAnswer = -1;
    gameState.revealedAnswer = false;
    gameState.hiddenAnswers = [];
    gameState.doubleActive = false;
    gameState.specialType = null;

    // Mark quiz as started (locks settings)
    gameState.quizStarted = true;

    // Roll for special round (fair per player)
    const specialType = rollSpecialType(player);
    if (specialType) trackSpecial(player, specialType);

    // Pick question based on special type
    let question;
    if (specialType === 'hardcore') {
      question = pickHardcoreQuestion();
    } else {
      question = pickQuestion(player);
    }

    if (!question) {
      io.emit('allQuestionsUsed');
      return;
    }

    gameState._pendingQuestion = question;
    gameState._pendingSpecial = specialType;

    io.emit('stateUpdate', sanitizeState());
    io.emit('playerSelected', {
      player: gameState.selectedPlayer,
      animate: gameState.players.length > 1,
      allPlayers: gameState.players,
    });

    const rouletteDelay = gameState.players.length > 1 ? 3800 : 1500;

    if (specialType) {
      // Show special intro after roulette, then question
      setTimeout(() => {
        gameState.screen = 'specialIntro';
        gameState.phase = 'specialIntro';
        gameState.specialType = specialType;
        io.emit('stateUpdate', sanitizeState());
        io.emit('specialRound', { type: specialType, player: gameState.selectedPlayer });
      }, rouletteDelay);

      setTimeout(() => {
        const q = gameState._pendingQuestion;
        if (!q) return;
        activateQuestion(q, specialType);
      }, rouletteDelay + 3000);
    } else {
      setTimeout(() => {
        const q = gameState._pendingQuestion;
        if (!q) return;
        activateQuestion(q, null);
      }, rouletteDelay);
    }
  });

  // ---- Select specific player ----
  socket.on('selectPlayerRound', (playerId) => {
    if (gameState.players.length === 0) return;
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const question = pickQuestion(player);
    if (!question) { io.emit('allQuestionsUsed'); return; }

    stopTimer();
    player.playCount++;
    gameState.selectedPlayer = { ...player };
    gameState.lastPlayerId = player.id;
    gameState.screen = 'playerSelect';
    gameState.phase = 'playerSelect';
    gameState.selectedAnswer = -1;
    gameState.revealedAnswer = false;
    gameState.hiddenAnswers = [];
    gameState.doubleActive = false;
    gameState._pendingQuestion = question;

    io.emit('stateUpdate', sanitizeState());
    io.emit('playerSelected', { player: gameState.selectedPlayer, animate: false });

    setTimeout(() => {
      const q = gameState._pendingQuestion;
      if (!q) return;
      activateQuestion(q, null);
    }, 1500);
  });

  // ============================================
  // SUBMIT ANSWER
  // ============================================
  socket.on('submitAnswer', (answerIndex) => {
    if (!gameState.currentQuestion || gameState.phase !== 'answering') return;

    stopTimer();

    gameState.selectedAnswer = answerIndex;
    gameState.screen = 'reveal';
    gameState.phase = 'revealed';

    const isCorrect = answerIndex === gameState.currentQuestion.correct;
    const correctText = gameState.currentQuestion.answers[gameState.currentQuestion.correct];
    const isSteal = !isCorrect && gameState.specialType === 'steal' && gameState.players.length > 1;

    // For steal rounds with wrong answer: DON'T reveal correct answer yet
    gameState.revealedAnswer = !isSteal;
    gameState.stealPending = isSteal;

    const pts = calculatePoints(gameState.currentQuestion, gameState.specialType);
    let pointsAwarded = 0;
    let risikoLost = 0;

    if (isCorrect && gameState.selectedPlayer) {
      const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
      if (player) {
        player.score += pts;
        pointsAwarded = pts;
        gameState.selectedPlayer = { ...player };
      }
    } else if (!isCorrect && gameState.risikoActive && gameState.selectedPlayer) {
      // Risiko penalty: lose half your score
      const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
      if (player) {
        risikoLost = Math.floor(player.score / 2);
        player.score -= risikoLost;
        gameState.selectedPlayer = { ...player };
      }
    }

    const gameOver = checkGameOver();
    addHistory(gameState.selectedPlayer, isCorrect, false, correctText);

    io.emit('answerResult', {
      chosenAnswer: answerIndex,
      correctAnswer: isSteal ? -1 : gameState.currentQuestion.correct,
      correctAnswerText: isSteal ? '???' : correctText,
      isCorrect,
      timedOut: false,
      player: gameState.selectedPlayer,
      doubleActive: gameState.doubleActive,
      risikoActive: gameState.risikoActive,
      specialType: gameState.specialType,
      pointsAwarded,
      risikoLost,
      stealPending: isSteal,
    });
    io.emit('stateUpdate', sanitizeState());

    if (isSteal) {
      setTimeout(() => offerSteal(gameOver), 2500);
      return;
    }

    autoAdvance(gameOver);
  });

  // ---- Steal answer ----
  socket.on('submitSteal', (answerIndex) => {
    if (gameState.phase !== 'stealing' || !gameState.stealPlayer) return;

    const isCorrect = answerIndex === gameState.currentQuestion.correct;
    const stealer = gameState.players.find(p => p.id === gameState.stealPlayer.id);

    if (isCorrect && stealer) {
      const pts = calculatePoints(gameState.currentQuestion, gameState.specialType);
      stealer.score += pts;
      gameState.stealPlayer = { ...stealer };
      addHistory(stealer, true, false, '', true);
    }

    // NOW reveal the correct answer
    gameState.stealActive = false;
    gameState.stealPending = false;
    gameState.revealedAnswer = true;
    gameState.phase = 'revealed';

    const correctText = gameState.currentQuestion.answers[gameState.currentQuestion.correct];
    io.emit('stealResult', {
      success: isCorrect,
      player: gameState.stealPlayer,
      pointsAwarded: isCorrect ? calculatePoints(gameState.currentQuestion, gameState.specialType) : 0,
      correctAnswer: gameState.currentQuestion.correct,
      correctAnswerText: correctText,
    });
    io.emit('stateUpdate', sanitizeState());

    const gameOver = checkGameOver();
    autoAdvance(gameOver);
  });

  // ============================================
  // JOKERS
  // ============================================
  socket.on('useFiftyFifty', () => {
    if (gameState.phase !== 'answering' || !gameState.currentQuestion || !gameState.selectedPlayer) return;
    const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
    if (!player || !player.jokers.fiftyFifty) return;

    player.jokers.fiftyFifty = false;
    gameState.selectedPlayer = { ...player };

    const correct = gameState.currentQuestion.correct;
    const wrongIndices = [0, 1, 2, 3].filter(i => i !== correct && !gameState.hiddenAnswers.includes(i));
    const shuffled = wrongIndices.sort(() => Math.random() - 0.5);
    gameState.hiddenAnswers = [...gameState.hiddenAnswers, ...shuffled.slice(0, 2)];

    io.emit('jokerUsed', { type: 'fiftyFifty', playerId: player.id, hiddenAnswers: gameState.hiddenAnswers });
    io.emit('stateUpdate', sanitizeState());
  });

  socket.on('useSkip', () => {
    if (gameState.phase !== 'answering' || !gameState.currentQuestion || !gameState.selectedPlayer) return;
    const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
    if (!player || !player.jokers.skip) return;

    player.jokers.skip = false;
    gameState.selectedPlayer = { ...player };
    stopTimer();

    const question = pickQuestion(player);
    if (!question) { io.emit('allQuestionsUsed'); return; }

    io.emit('jokerUsed', { type: 'skip', playerId: player.id });
    activateQuestion(question, gameState.specialType);
  });

  socket.on('useDoublePts', () => {
    if (gameState.phase !== 'answering' || !gameState.currentQuestion || !gameState.selectedPlayer) return;
    const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
    if (!player || !player.jokers.doublePts) return;

    player.jokers.doublePts = false;
    gameState.selectedPlayer = { ...player };
    gameState.doubleActive = true;

    io.emit('jokerUsed', { type: 'doublePts', playerId: player.id });
    io.emit('stateUpdate', sanitizeState());
  });

  socket.on('useRisiko', () => {
    if (gameState.phase !== 'answering' || !gameState.currentQuestion || !gameState.selectedPlayer) return;
    const player = gameState.players.find(p => p.id === gameState.selectedPlayer.id);
    if (!player || !player.jokers.risiko) return;
    if (gameState.risikoActive || gameState.doubleActive) return;

    player.jokers.risiko = false;
    gameState.selectedPlayer = { ...player };
    gameState.risikoActive = true;

    io.emit('jokerUsed', { type: 'risiko', playerId: player.id });
    io.emit('stateUpdate', sanitizeState());
  });

  // ============================================
  // MANUAL OVERRIDES
  // ============================================
  socket.on('showQuestion', ({ categoryIndex, questionIndex }) => {
    const category = questionsData.categories[categoryIndex];
    if (!category) return;
    const question = category.questions[questionIndex];
    if (!question) return;
    stopTimer();
    activateQuestion({ categoryIndex, questionIndex, category: category.name, ...question }, null);
  });

  socket.on('revealAnswer', () => {
    stopTimer();
    gameState.revealedAnswer = true;
    gameState.screen = 'reveal';
    gameState.phase = 'revealed';
    io.emit('stateUpdate', sanitizeState());
  });

  socket.on('addPoints', ({ playerId, points }) => {
    const player = gameState.players.find(p => p.id === playerId);
    if (player) { player.score += points; io.emit('stateUpdate', sanitizeState()); }
  });

  socket.on('subtractPoints', ({ playerId, points }) => {
    const player = gameState.players.find(p => p.id === playerId);
    if (player) { player.score -= points; io.emit('stateUpdate', sanitizeState()); }
  });

  // ============================================
  // SETTINGS
  // ============================================
  socket.on('updateSettings', (newSettings) => {
    if (gameState.quizStarted) {
      socket.emit('settingsLocked');
      return;
    }
    Object.assign(settings, newSettings);
    io.emit('stateUpdate', sanitizeState());
  });

  // ---- End current round early → scoreboard ----
  socket.on('endRound', () => {
    stopTimer();
    gameState.screen = 'scoreboard';
    gameState.phase = 'idle';
    gameState.specialType = null;
    gameState.stealActive = false;
    io.emit('stateUpdate', sanitizeState());
  });

  // ============================================
  // NEW ROUND (keep players, reset scores/history)
  // ============================================
  socket.on('newRound', () => {
    stopTimer();
    gameState = {
      screen: 'scoreboard',
      players: gameState.players.map(p => ({
        ...p, score: 0, playCount: 0,
        jokers: { fiftyFifty: true, skip: true, doublePts: true, risiko: true },
      })),
      currentQuestion: null,
      currentQuestionIndex: -1,
      currentCategory: null,
      selectedPlayer: null,
      selectedAnswer: -1,
      revealedAnswer: false,
      usedQuestions: [],
      questionNumber: 0,
      phase: 'idle',
      timerRemaining: 0,
      timerActive: false,
      lastPlayerId: null,
      hiddenAnswers: [],
      doubleActive: false,
      currentRound: 1,
      specialType: null,
      stealPlayer: null,
      stealActive: false,
      stealPending: false,
      risikoActive: false,
      difficultyTracker: {},
      specialTracker: {},
      history: [],
      quizStarted: true,
      gameOver: false,
    };
    gameState.players.forEach(p => {
      gameState.difficultyTracker[p.id] = { easy: 0, medium: 0, hard: 0, expert: 0 };
      gameState.specialTracker[p.id] = { blitz: 0, hardcore: 0, steal: 0, total: 0 };
    });
    io.emit('clearHistory');
    io.emit('stateUpdate', sanitizeState());
  });

  // ============================================
  // FULL RESET (back to intro)
  // ============================================
  socket.on('resetGame', () => {
    stopTimer();
    gameState = {
      screen: 'intro',
      players: gameState.players.map(p => ({
        ...p, score: 0, playCount: 0,
        jokers: { fiftyFifty: true, skip: true, doublePts: true, risiko: true },
      })),
      currentQuestion: null,
      currentQuestionIndex: -1,
      currentCategory: null,
      selectedPlayer: null,
      selectedAnswer: -1,
      revealedAnswer: false,
      usedQuestions: [],
      questionNumber: 0,
      phase: 'idle',
      timerRemaining: 0,
      timerActive: false,
      lastPlayerId: null,
      hiddenAnswers: [],
      doubleActive: false,
      currentRound: 1,
      specialType: null,
      stealPlayer: null,
      stealActive: false,
      stealPending: false,
      risikoActive: false,
      difficultyTracker: {},
      specialTracker: {},
      history: [],
      quizStarted: false,
      gameOver: false,
    };
    gameState.players.forEach(p => {
      gameState.difficultyTracker[p.id] = { easy: 0, medium: 0, hard: 0, expert: 0 };
    });
    io.emit('clearHistory');
    io.emit('stateUpdate', sanitizeState());
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 R6 Quiz Server running!`);
  console.log(`   Overlay: http://localhost:${PORT}/overlay`);
  console.log(`   Host:    http://localhost:${PORT}/host\n`);
});

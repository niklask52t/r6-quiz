const socket = io();

let gameState = null;
let questionsData = null;
let totalQuestions = 0;

let quizStarted = false;
const explainSlides = ['rules', 'jokerOverview', 'joker5050', 'jokerSkip', 'jokerDouble', 'jokerRisiko'];
let explainIndex = -1; // -1 = not in explanation flow

// ---- SOCKET EVENTS ----
socket.on('stateUpdate', (state) => {
  gameState = state;
  updateUI();
});

socket.on('questionsData', (data) => {
  questionsData = data;
  totalQuestions = data.categories.reduce((sum, cat) => sum + cat.questions.length, 0);
  populateCategorySelect();
  renderQuestionList();
  updateQuestionsRemaining();
});

socket.on('timerTick', (remaining) => {
  document.getElementById('host-timer').textContent = remaining;
});

socket.on('answerResult', ({ chosenAnswer, correctAnswer, correctAnswerText, isCorrect, timedOut, player, doubleActive, specialType, pointsAwarded }) => {
  const resultEl = document.getElementById('result-message');
  const specLabel = specialType ? ` [${specialType.toUpperCase()}]` : '';
  let historyText = '';
  let historyClass = '';

  if (timedOut) {
    resultEl.innerHTML = `⏱ <strong>${player.name}</strong>${specLabel} — ZEIT ABGELAUFEN! Richtig wäre: <strong>${correctAnswerText}</strong>`;
    resultEl.className = 'result-message result-timeout';
    historyText = `⏱ ${player.name} — Zeit abgelaufen (${correctAnswerText})`;
    historyClass = 'history-timeout';
  } else if (isCorrect) {
    resultEl.innerHTML = `✅ <strong>${player.name}</strong>${specLabel} — RICHTIG! (+${pointsAwarded} Punkte)`;
    resultEl.className = 'result-message result-correct';
    historyText = `✅ ${player.name} — Richtig! (+${pointsAwarded})`;
    historyClass = 'history-correct';
  } else {
    resultEl.innerHTML = `❌ <strong>${player.name}</strong>${specLabel} — FALSCH! Richtig: <strong>${correctAnswerText}</strong>`;
    resultEl.className = 'result-message result-wrong';
    historyText = `❌ ${player.name} — Falsch (${correctAnswerText})`;
    historyClass = 'history-wrong';
  }

  addHistoryEntry(historyText, historyClass, specialType);
});

socket.on('allQuestionsUsed', () => {
  alert('Alle Fragen wurden bereits gespielt!');
});

socket.on('settingsLocked', () => {
  alert('Einstellungen sind gesperrt! Das Quiz läuft bereits.');
});

socket.on('clearHistory', () => {
  clearHistoryLog();
});

socket.on('jokerUsed', ({ type, playerId }) => {
  const names = { fiftyFifty: '50/50', skip: 'SKIP', doublePts: '×2' };
  console.log(`Joker: ${names[type]}`);
});

socket.on('stealOffer', ({ player, question }) => {
  // Show steal controls
  document.getElementById('steal-host-player').textContent = player.name;
  if (question) {
    question.answers.forEach((ans, i) => {
      document.getElementById(`steal-text-${i}`).textContent = ans;
    });
  }
});

socket.on('stealResult', ({ success, player, pointsAwarded }) => {
  if (success) {
    addHistoryEntry(`🛡️ ${player.name} — STEAL Richtig! (+${pointsAwarded})`, 'history-correct', 'steal');
  } else {
    addHistoryEntry(`🛡️ ${player.name} — STEAL Falsch`, 'history-wrong', 'steal');
  }
});

// ---- UI UPDATE ----
function updateUI() {
  if (!gameState) return;

  const s = gameState.settings || {};

  document.getElementById('current-screen').textContent = gameState.screen;
  document.getElementById('current-phase').textContent = gameState.phase + (gameState.specialType ? ` [${gameState.specialType}]` : '');
  document.getElementById('current-round').textContent = `${gameState.currentRound || 1}/${s.totalRounds || 4}`;
  updateQuestionsRemaining();
  highlightScreenButton();

  const slideControls = document.getElementById('slide-controls');
  const autoControls = document.getElementById('auto-controls');
  const answerControls = document.getElementById('answer-controls');
  const resultDisplay = document.getElementById('result-display');
  const stealControls = document.getElementById('steal-controls');

  slideControls.classList.add('hidden');
  autoControls.classList.add('hidden');
  answerControls.classList.add('hidden');
  resultDisplay.classList.add('hidden');
  stealControls.classList.add('hidden');

  if (explainIndex >= 0) {
    // Showing explanation slides — show WEITER button
    slideControls.classList.remove('hidden');
    const btn = document.getElementById('btn-start-game');
    const hint = document.getElementById('slide-hint');
    const slideLabels = ['Regeln', 'Joker-Übersicht', '50/50', 'Skip', 'Doppelt', 'Risiko'];
    btn.textContent = explainIndex < explainSlides.length - 1 ? '▶ WEITER' : '🎮 LOS GEHT\'S!';
    btn.onclick = nextExplainSlide;
    if (hint) hint.textContent = `Folie ${explainIndex + 1}/${explainSlides.length}: ${slideLabels[explainIndex] || ''}`;
  } else if (gameState.phase === 'countdown') {
    // Show nothing during countdown — just wait
  } else if (gameState.phase === 'idle' || gameState.phase === 'playerSelect' || gameState.phase === 'specialIntro') {
    if (!quizStarted) {
      slideControls.classList.remove('hidden');
      const btn = document.getElementById('btn-start-game');
      const hint = document.getElementById('slide-hint');
      btn.textContent = '🎮 SPIEL BEGINNEN';
      btn.onclick = startGame;
      if (hint) hint.textContent = 'Spieler hinzufügen, dann Spiel starten!';
    } else {
      autoControls.classList.remove('hidden');
      updateAutoButton();
    }
  } else if (gameState.phase === 'answering') {
    answerControls.classList.remove('hidden');
    if (gameState.currentQuestion) {
      document.getElementById('answering-player').textContent = gameState.selectedPlayer ? gameState.selectedPlayer.name : '—';
      document.getElementById('answering-category').textContent = gameState.currentCategory || '—';
      document.getElementById('host-timer').textContent = gameState.timerRemaining;

      // Special indicator
      const specEl = document.getElementById('answering-special');
      if (gameState.specialType) {
        const labels = { blitz: '⚡ BLITZ', hardcore: '💀 HARDCORE', steal: '🛡️ STEAL' };
        specEl.textContent = labels[gameState.specialType] || '';
        specEl.className = `special-indicator special-host-${gameState.specialType}`;
      } else {
        specEl.textContent = '';
      }

      gameState.currentQuestion.answers.forEach((ans, i) => {
        const el = document.getElementById(`ans-text-${i}`);
        el.textContent = ans;
        const btn = el.closest('.btn-answer');
        if (gameState.hiddenAnswers && gameState.hiddenAnswers.includes(i)) {
          btn.classList.add('answer-hidden');
          btn.disabled = true;
        } else {
          btn.classList.remove('answer-hidden');
          btn.disabled = false;
        }
      });

      updateJokerButtons();
    }
  } else if (gameState.phase === 'stealing') {
    stealControls.classList.remove('hidden');
  } else if (gameState.phase === 'revealed') {
    resultDisplay.classList.remove('hidden');
    updateResultButtons();
  }

  renderPlayerList();
  updatePointsSelect();

  const revealBtn = document.getElementById('btn-reveal');
  revealBtn.disabled = !gameState.currentQuestion || gameState.revealedAnswer;

  renderQuestionList();
  loadSettingsUI();
  updateSettingsLock();
}

function updateJokerButtons() {
  if (!gameState || !gameState.selectedPlayer) return;
  const p = gameState.selectedPlayer;

  const btn5050 = document.getElementById('btn-5050');
  const btnSkip = document.getElementById('btn-skip');
  const btnDouble = document.getElementById('btn-double');

  const btnRisiko = document.getElementById('btn-risiko');

  btn5050.disabled = !p.jokers || !p.jokers.fiftyFifty || gameState.hiddenAnswers.length > 0;
  btnSkip.disabled = !p.jokers || !p.jokers.skip;
  btnDouble.disabled = !p.jokers || !p.jokers.doublePts || gameState.doubleActive || gameState.risikoActive;
  btnRisiko.disabled = !p.jokers || !p.jokers.risiko || gameState.risikoActive || gameState.doubleActive;

  btn5050.classList.toggle('joker-used', !p.jokers || !p.jokers.fiftyFifty);
  btnSkip.classList.toggle('joker-used', !p.jokers || !p.jokers.skip);
  btnDouble.classList.toggle('joker-used', !p.jokers || !p.jokers.doublePts);
  btnRisiko.classList.toggle('joker-used', !p.jokers || !p.jokers.risiko);

  if (gameState.doubleActive) btnDouble.classList.add('joker-active');
  else btnDouble.classList.remove('joker-active');

  if (gameState.risikoActive) btnRisiko.classList.add('joker-active');
  else btnRisiko.classList.remove('joker-active');
}

function updateQuestionsRemaining() {
  const used = gameState ? gameState.usedQuestions.length : 0;
  document.getElementById('questions-remaining').textContent = `${totalQuestions - used}/${totalQuestions}`;
}

// ---- START GAME ----
function startGame() {
  if (!gameState) return;
  if (gameState.players.length === 0) {
    alert('Füge erst Spieler hinzu!');
    return;
  }
  // Start explanation flow
  explainIndex = 0;
  setScreen(explainSlides[0]);
}

function nextExplainSlide() {
  explainIndex++;
  if (explainIndex < explainSlides.length) {
    setScreen(explainSlides[explainIndex]);
  } else {
    // Done with explanation → countdown
    explainIndex = -1;
    quizStarted = true;
    socket.emit('startCountdown');
  }
}

// ---- ACTIONS ----
function nextRound() { socket.emit('nextRound'); }
function submitAnswer(idx) { socket.emit('submitAnswer', idx); }
function submitSteal(idx) { socket.emit('submitSteal', idx); }
function endRound() { socket.emit('endRound'); }
function useFiftyFifty() { socket.emit('useFiftyFifty'); }
function useSkip() { socket.emit('useSkip'); }
function useDoublePts() { socket.emit('useDoublePts'); }
function useRisiko() { socket.emit('useRisiko'); }
function setScreen(screen) { socket.emit('setScreen', screen); }

// ---- PLAYER MANAGEMENT ----
function addPlayer() {
  const input = document.getElementById('player-name-input');
  const name = input.value.trim();
  if (!name) return;
  socket.emit('addPlayer', name);
  input.value = '';
  input.focus();
}

document.getElementById('player-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPlayer();
});

function removePlayer(id) { socket.emit('removePlayer', id); }
function selectPlayerRound(id) { socket.emit('selectPlayerRound', id); }

function renderPlayerList() {
  const list = document.getElementById('player-list');
  if (!gameState) { list.innerHTML = ''; return; }

  list.innerHTML = gameState.players.map(p => {
    const jokers = [];
    if (p.jokers.fiftyFifty) jokers.push('<span class="joker-badge">½</span>');
    if (p.jokers.skip) jokers.push('<span class="joker-badge">⟳</span>');
    if (p.jokers.doublePts) jokers.push('<span class="joker-badge">×2</span>');
    if (p.jokers.risiko) jokers.push('<span class="joker-badge" style="color:#ff1744">💀</span>');
    const jokersHtml = jokers.length > 0 ? jokers.join('') : '<span class="no-jokers">keine</span>';

    return `
      <div class="player-item">
        <div class="player-item-info">
          <span class="player-item-name">${p.name}</span>
          <span class="player-item-score">${p.score} PTS</span>
          <span class="player-item-plays">(${p.playCount}× dran)</span>
          <span class="player-item-jokers">${jokersHtml}</span>
        </div>
        <div class="player-item-actions">
          <button onclick="selectPlayerRound('${p.id}')" class="btn btn-sm" title="Dieser Spieler nächste Frage">▶</button>
          <button onclick="removePlayer('${p.id}')" class="btn btn-sm btn-red">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function updatePointsSelect() {
  const select = document.getElementById('points-player-select');
  if (!gameState) return;
  const current = select.value;
  select.innerHTML = gameState.players.map(p =>
    `<option value="${p.id}">${p.name} (${p.score} PTS)</option>`
  ).join('');
  if (current && gameState.players.some(p => p.id === current)) select.value = current;
}

// ---- SETTINGS ----
function loadSettingsUI() {
  if (!gameState || !gameState.settings) return;
  const s = gameState.settings;
  // Only update if not focused (don't overwrite while user is typing)
  const fields = {
    's-pointsPerQuestion': s.pointsPerQuestion,
    's-timerDuration': s.timerDuration,
    's-totalRounds': s.totalRounds,
    's-diffEasy': s.difficultyPoints.easy,
    's-diffMedium': s.difficultyPoints.medium,
    's-diffHard': s.difficultyPoints.hard,
    's-diffExpert': s.difficultyPoints.expert,
    's-blitzChance': s.blitzChance,
    's-blitzTimer': s.blitzTimer,
    's-blitzPointsMultiplier': s.blitzPointsMultiplier,
    's-hardcoreChance': s.hardcoreChance,
    's-hardcorePointsMultiplier': s.hardcorePointsMultiplier,
    's-stealChance': s.stealChance,
  };

  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) el.value = val;
  }

  const checkboxes = {
    's-fairDifficulty': s.fairDifficulty,
    's-blitzEnabled': s.blitzEnabled,
    's-hardcoreEnabled': s.hardcoreEnabled,
    's-stealEnabled': s.stealEnabled,
  };

  for (const [id, val] of Object.entries(checkboxes)) {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) el.checked = val;
  }
}

function saveSettings() {
  const s = {
    pointsPerQuestion: parseInt(document.getElementById('s-pointsPerQuestion').value) || 1,
    timerDuration: parseInt(document.getElementById('s-timerDuration').value) || 60,
    totalRounds: parseInt(document.getElementById('s-totalRounds').value) || 4,
    fairDifficulty: document.getElementById('s-fairDifficulty').checked,
    difficultyPoints: {
      easy: parseInt(document.getElementById('s-diffEasy').value) || 1,
      medium: parseInt(document.getElementById('s-diffMedium').value) || 1,
      hard: parseInt(document.getElementById('s-diffHard').value) || 2,
      expert: parseInt(document.getElementById('s-diffExpert').value) || 3,
    },
    blitzEnabled: document.getElementById('s-blitzEnabled').checked,
    blitzChance: parseInt(document.getElementById('s-blitzChance').value) || 0,
    blitzTimer: parseInt(document.getElementById('s-blitzTimer').value) || 15,
    blitzPointsMultiplier: parseInt(document.getElementById('s-blitzPointsMultiplier').value) || 2,
    hardcoreEnabled: document.getElementById('s-hardcoreEnabled').checked,
    hardcoreChance: parseInt(document.getElementById('s-hardcoreChance').value) || 0,
    hardcorePointsMultiplier: parseInt(document.getElementById('s-hardcorePointsMultiplier').value) || 3,
    stealEnabled: document.getElementById('s-stealEnabled').checked,
    stealChance: parseInt(document.getElementById('s-stealChance').value) || 0,
  };
  socket.emit('updateSettings', s);
}

// ---- HISTORY LOG ----
function addHistoryEntry(text, className, specialType) {
  const log = document.getElementById('history-log');
  const empty = log.querySelector('.history-empty');
  if (empty) empty.remove();

  const category = gameState && gameState.currentCategory ? gameState.currentCategory : '';
  const qNum = gameState ? gameState.questionNumber : '';
  const diff = gameState && gameState.currentQuestion ? gameState.currentQuestion.difficulty : '';
  const specIcon = specialType === 'blitz' ? '⚡' : specialType === 'hardcore' ? '💀' : specialType === 'steal' ? '🛡️' : '';

  const entry = document.createElement('div');
  entry.className = `history-entry ${className}`;
  entry.innerHTML = `
    <span class="history-round">F${qNum}</span>
    <span class="history-cat">${category}</span>
    ${diff ? `<span class="history-diff diff-host-${diff}">${diff}</span>` : ''}
    ${specIcon ? `<span class="history-special">${specIcon}</span>` : ''}
    ${text}
  `;
  log.prepend(entry);
}

// ---- DYNAMIC BUTTONS ----
function updateAutoButton() {
  if (!gameState) return;
  const btn = document.getElementById('btn-next-round');
  const newRoundBtn = document.getElementById('btn-new-round');
  const s = gameState.settings || {};
  const allPlayed = gameState.players.length > 0 && gameState.players.every(p => p.playCount >= s.totalRounds);

  if (allPlayed || gameState.gameOver) {
    btn.textContent = '🏆 ERGEBNISSE ANZEIGEN';
    btn.className = 'btn btn-big btn-green';
    if (newRoundBtn) newRoundBtn.style.display = '';
  } else {
    btn.textContent = '▶ NÄCHSTE RUNDE';
    btn.className = 'btn btn-big btn-accent';
    if (newRoundBtn) newRoundBtn.style.display = 'none';
  }
}

function updateResultButtons() {
  if (!gameState) return;
  const container = document.getElementById('result-display');
  const btnRow = container.querySelector('.btn-row');
  if (!btnRow) return;

  const s = gameState.settings || {};
  const allPlayed = gameState.players.length > 0 && gameState.players.every(p => p.playCount >= gameState.currentRound);
  const isLastRound = gameState.currentRound >= (s.totalRounds || 4);
  const gameOver = allPlayed && isLastRound;

  if (gameOver || gameState.gameOver) {
    btnRow.innerHTML = `
      <button onclick="nextRound()" class="btn btn-big btn-green">🏆 ERGEBNISSE ANZEIGEN</button>
      <button onclick="newRoundStart()" class="btn btn-accent">🔄 Neue Runde starten</button>
    `;
  } else {
    btnRow.innerHTML = `
      <button onclick="nextRound()" class="btn btn-big btn-accent">▶ NÄCHSTE RUNDE</button>
      <button onclick="endRound()" class="btn">📊 Scoreboard</button>
    `;
  }
}

function updateSettingsLock() {
  if (!gameState) return;
  const locked = gameState.quizStarted;
  const settingsInputs = document.querySelectorAll('.settings-grid input, .settings-grid select');
  const saveBtn = document.querySelector('[onclick="saveSettings()"]');

  settingsInputs.forEach(el => el.disabled = locked);
  if (saveBtn) {
    saveBtn.disabled = locked;
    saveBtn.textContent = locked ? '🔒 Gesperrt (Quiz läuft)' : '💾 Einstellungen speichern';
  }
}

function clearHistoryLog() {
  const log = document.getElementById('history-log');
  log.innerHTML = '<div class="history-empty">Noch keine Runden gespielt</div>';
}

// ---- GAME CONTROL ----
function newRoundStart() {
  if (confirm('Neue Runde starten? Punkte und Verlauf werden zurückgesetzt, Spieler bleiben.')) {
    clearHistoryLog();
    socket.emit('newRound');
  }
}

function resetGame() {
  if (confirm('Komplett zurücksetzen? Alles wird zurückgesetzt und es geht zum Intro.')) {
    quizStarted = false;
    explainIndex = -1;
    clearHistoryLog();
    socket.emit('resetGame');
  }
}

// ---- MANUAL QUESTION CONTROL ----
function populateCategorySelect() {
  if (!questionsData) return;
  const select = document.getElementById('category-select');
  select.innerHTML = questionsData.categories.map((cat, i) =>
    `<option value="${i}">${cat.icon} ${cat.name}</option>`
  ).join('');
}

function renderQuestionList() {
  if (!questionsData) return;
  const catIdx = parseInt(document.getElementById('category-select').value) || 0;
  const category = questionsData.categories[catIdx];
  if (!category) return;

  const list = document.getElementById('question-list');
  list.innerHTML = category.questions.map((q, i) => {
    const usedKey = `${catIdx}-${i}`;
    const isUsed = gameState && gameState.usedQuestions.includes(usedKey);
    const isActive = gameState && gameState.currentQuestion &&
      gameState.currentQuestion.question === q.question;
    return `
      <div class="question-item${isUsed ? ' used' : ''}${isActive ? ' active' : ''}"
           onclick="showQuestion(${catIdx}, ${i})">
        <span class="q-difficulty ${q.difficulty}">${q.difficulty}</span>
        <span class="q-item-text">${q.question}</span>
      </div>
    `;
  }).join('');
}

function showQuestion(catIdx, qIdx) { socket.emit('showQuestion', { categoryIndex: catIdx, questionIndex: qIdx }); }
function revealAnswer() { socket.emit('revealAnswer'); }

function givePoints(mult) {
  const playerId = document.getElementById('points-player-select').value;
  const amount = parseInt(document.getElementById('points-amount').value) || 1;
  if (!playerId) return;
  socket.emit(mult > 0 ? 'addPoints' : 'subtractPoints', { playerId, points: amount });
}

function highlightScreenButton() {
  if (!gameState) return;
  document.querySelectorAll('.screen-btn').forEach(btn => {
    btn.classList.toggle('screen-active', btn.dataset.screen === gameState.screen);
  });
}

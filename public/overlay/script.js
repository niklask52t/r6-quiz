const socket = io();

let currentScreen = 'intro';
let timerDuration = 60;

// =============================================
// FX ENGINE — Global particle/flash system
// =============================================
function spawnParticles(x, y, count, color, spread) {
  const container = document.getElementById('fx-particles');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'fx-particle';
    const angle = Math.random() * Math.PI * 2;
    const dist = (spread || 120) * (0.3 + Math.random() * 0.7);
    const size = 3 + Math.random() * 6;
    p.style.cssText = `
      left:${x}px; top:${y}px; width:${size}px; height:${size}px;
      background:${color || '#ff6600'};
      --tx:${Math.cos(angle) * dist}px; --ty:${Math.sin(angle) * dist}px;
      animation-duration:${0.6 + Math.random() * 0.8}s;
      animation-delay:${Math.random() * 0.2}s;
    `;
    container.appendChild(p);
    setTimeout(() => p.remove(), 2000);
  }
}

function screenFlash(color, duration) {
  const flash = document.getElementById('fx-flash');
  flash.style.background = color || 'rgba(255,102,0,0.3)';
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), duration || 400);
}

function spawnGlitchLines() {
  const container = document.getElementById('fx-particles');
  for (let i = 0; i < 8; i++) {
    const line = document.createElement('div');
    line.className = 'fx-glitch-line';
    line.style.top = `${Math.random() * 100}%`;
    line.style.animationDelay = `${Math.random() * 0.3}s`;
    container.appendChild(line);
    setTimeout(() => line.remove(), 600);
  }
}

// =============================================
// SCREEN MANAGEMENT
// =============================================
function showScreen(screenId) {
  if (screenId === currentScreen) return;

  const oldScreen = document.getElementById(`screen-${currentScreen}`);
  const newScreen = document.getElementById(`screen-${screenId}`);
  if (!newScreen) return;

  // Glitch effect on transition
  spawnGlitchLines();

  if (oldScreen) {
    oldScreen.classList.remove('active');
    oldScreen.classList.add('exit-zoom');
    setTimeout(() => oldScreen.classList.remove('exit-zoom'), 600);
  }

  setTimeout(() => {
    document.querySelectorAll('.screen').forEach(s => {
      if (s !== newScreen) s.classList.remove('active');
    });
    newScreen.classList.add('active');
    currentScreen = screenId;
  }, 150);
}

// =============================================
// TIMER
// =============================================
function updateTimer(remaining) {
  const bar = document.getElementById('timer-bar');
  const text = document.getElementById('timer-text');
  if (!bar || !text) return;

  text.textContent = remaining;
  const pct = (remaining / timerDuration) * 100;
  bar.style.width = `${pct}%`;

  bar.classList.remove('timer-warn', 'timer-danger', 'timer-critical');
  if (remaining <= 5) {
    bar.classList.add('timer-critical');
    // Shake on last 5 seconds
    const qScreen = document.getElementById('screen-question');
    qScreen.classList.add('timer-shake');
    setTimeout(() => qScreen.classList.remove('timer-shake'), 300);
  } else if (pct <= 15) {
    bar.classList.add('timer-danger');
  } else if (pct <= 35) {
    bar.classList.add('timer-warn');
  }
}

// =============================================
// PLAYERS RENDERING
// =============================================
function renderPlayers(players) {
  const grid = document.getElementById('players-grid');
  grid.innerHTML = '';
  players.forEach((player, i) => {
    const jokerIcons = [];
    if (player.jokers.fiftyFifty) jokerIcons.push('<span class="joker-pip">½</span>');
    if (player.jokers.skip) jokerIcons.push('<span class="joker-pip">⟳</span>');
    if (player.jokers.doublePts) jokerIcons.push('<span class="joker-pip">×2</span>');

    const card = document.createElement('div');
    card.className = 'player-card';
    card.style.animationDelay = `${i * 0.15}s`;
    card.innerHTML = `
      <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
      <div class="player-name">${player.name}</div>
      <div class="player-score">${player.score} PTS</div>
      <div class="player-jokers">${jokerIcons.join('')}</div>
    `;
    grid.appendChild(card);
  });
}

// =============================================
// QUESTION RENDERING
// =============================================
function renderQuestion(state, prefix) {
  const cat = document.getElementById(`${prefix}-category`);
  const num = document.getElementById(`${prefix}-number`);
  const text = document.getElementById(`${prefix}-text`);
  const imgContainer = document.getElementById(`${prefix}-image-container`);
  const img = document.getElementById(`${prefix}-image`);
  const gridId = prefix === 'q' ? 'answers-grid' : 'reveal-grid';
  const grid = document.getElementById(gridId);

  if (!state.currentQuestion) return;

  cat.textContent = state.currentCategory || 'KATEGORIE';
  num.textContent = `FRAGE ${state.questionNumber}`;
  text.textContent = state.currentQuestion.question;

  // Double badge
  const doubleBadge = document.getElementById(`${prefix === 'q' ? 'q' : 'r'}-double-badge`);
  if (doubleBadge) doubleBadge.classList.toggle('hidden', !state.doubleActive);

  // Difficulty badge (question screen only)
  if (prefix === 'q') {
    const diffBadge = document.getElementById('q-diff-badge');
    if (diffBadge) {
      const d = state.currentQuestion.difficulty || 'easy';
      diffBadge.textContent = d.toUpperCase();
      diffBadge.className = `diff-badge diff-${d}`;
    }

    // Special round bar
    const specialBar = document.getElementById('special-bar');
    const specialBarIcon = document.getElementById('special-bar-icon');
    const specialBarText = document.getElementById('special-bar-text');
    if (state.specialType) {
      specialBar.classList.remove('hidden');
      specialBar.className = `special-bar special-${state.specialType}`;
      const specials = {
        blitz: { icon: '/assets/icons/frozen-arrow.svg', text: 'BLITZRUNDE — BLACK ICE' },
        hardcore: { icon: '/assets/icons/skull-crossed-bones.svg', text: 'HARDCORE' },
        steal: { icon: '/assets/icons/shield-reflect.svg', text: 'STEAL RUNDE' },
      };
      const spec = specials[state.specialType];
      if (spec) {
        specialBarIcon.src = spec.icon;
        specialBarText.textContent = spec.text;
      }
    } else {
      specialBar.classList.add('hidden');
    }
  }

  // Image
  if (state.currentQuestion.image) {
    imgContainer.classList.remove('hidden');
    const imgPath = state.currentQuestion.image.startsWith('/') ? state.currentQuestion.image : '/' + state.currentQuestion.image;
    img.src = imgPath;
    imgContainer.classList.toggle('icon-quiz', state.currentQuestion.image.includes('operators/'));
  } else {
    imgContainer.classList.add('hidden');
    imgContainer.classList.remove('icon-quiz');
  }

  // Answers
  const boxes = grid.querySelectorAll('.answer-box');
  boxes.forEach((box, idx) => {
    const textEl = box.querySelector('.answer-text');
    textEl.textContent = state.currentQuestion.answers[idx] || '';
    box.className = 'answer-box';
    box.style.animationDelay = `${idx * 0.1}s`;

    if (state.hiddenAnswers && state.hiddenAnswers.includes(idx)) {
      box.classList.add('hidden-5050');
    }

    if (prefix === 'r' && state.revealedAnswer) {
      if (idx === state.currentQuestion.correct) {
        box.classList.add('correct');
      } else if (idx === state.selectedAnswer && state.selectedAnswer !== state.currentQuestion.correct) {
        box.classList.add('wrong', 'chosen');
      } else {
        box.classList.add('wrong');
      }
    }
  });

  // Player indicator
  const indicatorId = prefix === 'q' ? 'current-player-indicator' : 'reveal-player-indicator';
  const indicator = document.getElementById(indicatorId);
  if (state.selectedPlayer) {
    indicator.textContent = `▶ ${state.selectedPlayer.name}`;
  } else {
    indicator.textContent = '';
  }

  if (prefix === 'q' && state.selectedPlayer) {
    renderJokerDisplay(state.selectedPlayer);
  }
}

// =============================================
// JOKER DISPLAY
// =============================================
function renderJokerDisplay(player) {
  const container = document.getElementById('q-jokers');
  if (!container || !player || !player.jokers) { container.innerHTML = ''; return; }

  const jokers = [];
  if (player.jokers.fiftyFifty) jokers.push('<span class="joker-tag">50/50</span>');
  if (player.jokers.skip) jokers.push('<span class="joker-tag">SKIP</span>');
  if (player.jokers.doublePts) jokers.push('<span class="joker-tag">×2</span>');
  container.innerHTML = jokers.length > 0 ? `JOKER: ${jokers.join(' ')}` : '';
}

// =============================================
// RESULT BANNER
// =============================================
function showResultBanner(data) {
  const banner = document.getElementById('result-banner');
  const bannerText = document.getElementById('result-banner-text');
  const bannerSub = document.getElementById('result-banner-sub');

  banner.classList.remove('banner-correct', 'banner-wrong', 'banner-timeout');

  if (data.timedOut) {
    banner.classList.add('banner-timeout');
    bannerText.textContent = 'ZEIT ABGELAUFEN!';
    bannerSub.textContent = data.stealPending ? 'STEAL CHANCE...' : `Richtig wäre: ${data.correctAnswerText}`;
    screenFlash('rgba(255,234,0,0.3)');
  } else if (data.isCorrect) {
    banner.classList.add('banner-correct');
    bannerText.textContent = 'RICHTIG!';
    const ptsText = data.pointsAwarded ? `+${data.pointsAwarded} PUNKTE` : '+1 PUNKT';
    bannerSub.textContent = `${data.player.name} ${ptsText}`;
    screenFlash('rgba(0,230,118,0.25)');
    spawnParticles(960, 300, 40, '#00e676', 200);
  } else {
    banner.classList.add('banner-wrong');
    bannerText.textContent = 'FALSCH!';
    bannerSub.textContent = data.stealPending ? 'STEAL CHANCE...' : `Richtig wäre: ${data.correctAnswerText}`;
    screenFlash('rgba(255,23,68,0.25)');
  }
}

// =============================================
// SPECIAL ROUND INTRO
// =============================================
function showSpecialIntro(type, player) {
  const specials = {
    blitz: {
      icon: '/assets/icons/frozen-arrow.svg',
      title: 'BLITZRUNDE',
      subtitle: 'Wenig Zeit — Extra Punkte!',
      color: '#4fc3f7',
      bgClass: 'special-bg-blitz',
    },
    hardcore: {
      icon: '/assets/icons/skull-crossed-bones.svg',
      title: 'HARDCORE',
      subtitle: 'Extrem schwer — ×3 Punkte!',
      color: '#ff1744',
      bgClass: 'special-bg-hardcore',
    },
    steal: {
      icon: '/assets/icons/shield-reflect.svg',
      title: 'STEAL RUNDE',
      subtitle: 'Falsch? Jemand anderes kann klauen!',
      color: '#2979ff',
      bgClass: 'special-bg-steal',
    },
  };

  const spec = specials[type];
  if (!spec) return;

  document.getElementById('special-icon').src = spec.icon;
  document.getElementById('special-title').textContent = spec.title;
  document.getElementById('special-title').style.color = spec.color;
  document.getElementById('special-subtitle').textContent = spec.subtitle;
  document.getElementById('special-player').textContent = player ? `▶ ${player.name}` : '';

  const bg = document.getElementById('special-bg');
  bg.className = `special-bg ${spec.bgClass}`;

  // Dramatic effects
  screenFlash(spec.color.replace(')', ',0.3)').replace('rgb', 'rgba'), 600);
  setTimeout(() => spawnParticles(960, 540, 60, spec.color, 300), 300);
}

// =============================================
// SCOREBOARD
// =============================================
function renderScoreboard(players) {
  const list = document.getElementById('scoreboard-list');
  list.innerHTML = '';

  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach((player, i) => {
    const row = document.createElement('div');
    row.className = `score-row${i === 0 ? ' first' : ''}`;
    row.style.animationDelay = `${i * 0.12}s`;
    row.innerHTML = `
      <div class="score-rank">#${i + 1}</div>
      <div class="score-name">${player.name}</div>
      <div class="score-points">${player.score}</div>
    `;
    list.appendChild(row);
  });
}

// =============================================
// FINALE
// =============================================
let finaleStarted = false;

function renderFinale(players) {
  if (finaleStarted) return;
  finaleStarted = true;

  const sorted = [...players].sort((a, b) => b.score - a.score);
  const first = sorted[0] || { name: '---', score: 0 };
  const second = sorted[1] || null;
  const third = sorted[2] || null;

  document.getElementById('finale-name-1').textContent = first.name;
  document.getElementById('finale-score-1').textContent = `${first.score} PTS`;
  if (second) {
    document.getElementById('finale-name-2').textContent = second.name;
    document.getElementById('finale-score-2').textContent = `${second.score} PTS`;
  }
  if (third) {
    document.getElementById('finale-name-3').textContent = third.name;
    document.getElementById('finale-score-3').textContent = `${third.score} PTS`;
  }

  const screen = document.getElementById('screen-finale');
  const intro = document.getElementById('finale-intro');
  const introText = intro.querySelector('.finale-intro-text');
  const podium = document.getElementById('finale-podium');

  // Dramatic countdown
  screenFlash('rgba(255,102,0,0.2)', 600);

  // Drumroll glitch effects during intro
  let drumrollInterval = setInterval(() => {
    spawnGlitchLines();
    screenFlash('rgba(255,102,0,0.08)', 150);
  }, 400);

  // Countdown numbers
  setTimeout(() => { introText.textContent = '3'; screenFlash('rgba(255,102,0,0.15)'); spawnParticles(960, 540, 15, '#ff6600', 100); }, 1500);
  setTimeout(() => { introText.textContent = '2'; screenFlash('rgba(255,234,0,0.15)'); spawnParticles(960, 540, 15, '#ffea00', 100); }, 2500);
  setTimeout(() => { introText.textContent = '1'; screenFlash('rgba(255,23,68,0.15)'); spawnParticles(960, 540, 15, '#ff1744', 100); }, 3500);

  setTimeout(() => {
    clearInterval(drumrollInterval);
    intro.classList.add('fade-out');
    podium.classList.remove('hidden');
    screenFlash('rgba(255,255,255,0.15)', 400);
  }, 4500);

  // 3rd place
  setTimeout(() => {
    if (third) {
      document.getElementById('finale-3rd').classList.remove('hidden');
      document.getElementById('finale-3rd').classList.add('reveal');
      spawnSparks(400, 700);
      spawnParticles(400, 600, 20, '#cd7f32', 120);
      screenFlash('rgba(205,127,50,0.15)', 300);
    }
  }, 5500);

  // 2nd place
  setTimeout(() => {
    if (second) {
      document.getElementById('finale-2nd').classList.remove('hidden');
      document.getElementById('finale-2nd').classList.add('reveal');
      spawnSparks(1400, 700);
      spawnParticles(1400, 600, 30, '#c0c0c0', 150);
      screenFlash('rgba(192,192,192,0.2)', 400);
      screen.classList.add('screen-shake');
      setTimeout(() => screen.classList.remove('screen-shake'), 600);
    }
  }, 8000);

  // 1st place — THE BIG REVEAL
  setTimeout(() => {
    // Pre-flash buildup
    spawnGlitchLines();
    screenFlash('rgba(255,255,255,0.1)', 200);
  }, 10500);

  setTimeout(() => {
    spawnGlitchLines();
    screenFlash('rgba(255,102,0,0.2)', 200);
    screen.classList.add('screen-shake');
    setTimeout(() => screen.classList.remove('screen-shake'), 400);
  }, 11000);

  setTimeout(() => {
    // THE REVEAL
    document.getElementById('finale-1st').classList.remove('hidden');
    document.getElementById('finale-1st').classList.add('reveal');

    // Massive flash + shake
    screen.classList.add('finale-flash', 'screen-shake');
    setTimeout(() => screen.classList.remove('finale-flash', 'screen-shake'), 1000);

    // Huge particle explosion
    screenFlash('rgba(255,234,0,0.4)', 800);
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        spawnParticles(960, 400, 30, '#ffea00', 300);
        spawnParticles(960, 400, 20, '#ff6600', 250);
      }, i * 200);
    }
    spawnSparks(960, 400);
    spawnSparks(960, 300);
    spawnSparks(760, 400);
    spawnSparks(1160, 400);

    // Winner banner
    document.getElementById('finale-winner-banner').classList.remove('hidden');
    document.getElementById('finale-winner-banner').classList.add('reveal');
    document.getElementById('finale-winner-text').textContent = `${first.name} IST CHAMPION!`;

    // Confetti waves
    spawnConfetti();
    setTimeout(() => spawnConfetti(), 1000);
    setTimeout(() => spawnConfetti(), 2000);
    setTimeout(() => spawnConfetti(), 3500);
    setTimeout(() => spawnConfetti(), 5000);

    // Sustained sparks
    let sparkBurst = 0;
    const sparkInterval = setInterval(() => {
      spawnSparks(300 + Math.random() * 1320, 300 + Math.random() * 400);
      sparkBurst++;
      if (sparkBurst > 8) clearInterval(sparkInterval);
    }, 800);
  }, 11500);
}

function spawnConfetti() {
  const container = document.getElementById('confetti-container');
  const colors = ['#ff6600', '#ff1744', '#00e676', '#2979ff', '#ffea00', '#e040fb', '#ffffff'];
  for (let i = 0; i < 100; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDuration = `${2 + Math.random() * 4}s`;
    c.style.animationDelay = `${Math.random() * 1.5}s`;
    c.style.width = `${6 + Math.random() * 12}px`;
    c.style.height = `${10 + Math.random() * 18}px`;
    container.appendChild(c);
    setTimeout(() => c.remove(), 7000);
  }
}

function resetFinaleUI() {
  const intro = document.getElementById('finale-intro');
  const podium = document.getElementById('finale-podium');
  const banner = document.getElementById('finale-winner-banner');
  if (intro) {
    intro.classList.remove('fade-out');
    const introText = intro.querySelector('.finale-intro-text');
    if (introText) introText.textContent = 'UND DER GEWINNER IST...';
  }
  if (podium) podium.classList.add('hidden');
  if (banner) { banner.classList.add('hidden'); banner.classList.remove('reveal'); }
  ['finale-1st', 'finale-2nd', 'finale-3rd'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.classList.remove('reveal'); }
  });
  const confetti = document.getElementById('confetti-container');
  const sparks = document.getElementById('finale-sparks');
  if (confetti) confetti.innerHTML = '';
  if (sparks) sparks.innerHTML = '';
}

function spawnSparks(x, y) {
  const container = document.getElementById('finale-sparks');
  for (let i = 0; i < 25; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 200;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
    s.style.animationDuration = `${0.5 + Math.random() * 1}s`;
    s.style.animationDelay = `${Math.random() * 0.3}s`;
    container.appendChild(s);
    setTimeout(() => s.remove(), 2000);
  }
}

// =============================================
// GAME START COUNTDOWN
// =============================================
function runGameCountdown() {
  const numEl = document.getElementById('countdown-number');
  const labelEl = document.getElementById('countdown-label');
  const subEl = document.getElementById('countdown-sub');
  const grid = document.getElementById('countdown-grid');

  if (!numEl) return;

  // Spawn animated hex grid background
  grid.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const hex = document.createElement('div');
    hex.className = 'hex-cell';
    hex.style.left = `${Math.random() * 100}%`;
    hex.style.top = `${Math.random() * 100}%`;
    hex.style.animationDelay = `${Math.random() * 3}s`;
    hex.style.animationDuration = `${2 + Math.random() * 3}s`;
    grid.appendChild(hex);
  }

  numEl.textContent = '';
  labelEl.textContent = 'GAME STARTET IN';
  labelEl.className = 'countdown-label';
  subEl.textContent = 'MACH DICH BEREIT';
  subEl.className = 'countdown-sub';

  // Initial flash
  screenFlash('rgba(255,102,0,0.3)', 500);
  spawnGlitchLines();

  // Glitch buildup
  let glitchInterval = setInterval(() => {
    spawnGlitchLines();
  }, 300);

  // === 3 ===
  setTimeout(() => {
    numEl.textContent = '3';
    numEl.className = 'countdown-number cd-slam';
    screenFlash('rgba(255,102,0,0.25)', 300);
    spawnParticles(960, 540, 50, '#ff6600', 300);
    spawnParticles(960, 540, 30, '#ffea00', 200);
    // Screen shake
    const screen = document.getElementById('screen-countdown');
    screen.classList.add('screen-shake');
    setTimeout(() => screen.classList.remove('screen-shake'), 500);
    // Side bursts
    spawnParticles(100, 540, 20, '#ff6600', 150);
    spawnParticles(1820, 540, 20, '#ff6600', 150);
  }, 800);

  // === 2 ===
  setTimeout(() => {
    numEl.textContent = '2';
    numEl.className = 'countdown-number cd-slam';
    void numEl.offsetWidth; // force reflow for re-animation
    numEl.className = 'countdown-number cd-slam cd-two';
    screenFlash('rgba(255,234,0,0.3)', 300);
    spawnParticles(960, 540, 60, '#ffea00', 350);
    spawnParticles(960, 540, 40, '#ff6600', 250);
    spawnGlitchLines();
    const screen = document.getElementById('screen-countdown');
    screen.classList.add('screen-shake');
    setTimeout(() => screen.classList.remove('screen-shake'), 500);
    spawnParticles(200, 200, 25, '#ffea00', 180);
    spawnParticles(1720, 880, 25, '#ffea00', 180);
  }, 2200);

  // === 1 ===
  setTimeout(() => {
    numEl.textContent = '1';
    numEl.className = 'countdown-number cd-slam';
    void numEl.offsetWidth;
    numEl.className = 'countdown-number cd-slam cd-one';
    screenFlash('rgba(255,23,68,0.35)', 400);
    spawnParticles(960, 540, 80, '#ff1744', 400);
    spawnParticles(960, 540, 50, '#ff6600', 300);
    spawnParticles(960, 540, 30, '#ffea00', 200);
    spawnGlitchLines();
    spawnGlitchLines();
    const screen = document.getElementById('screen-countdown');
    screen.classList.add('screen-shake');
    setTimeout(() => screen.classList.remove('screen-shake'), 600);
    // Corner bursts
    spawnParticles(100, 100, 20, '#ff1744', 150);
    spawnParticles(1820, 100, 20, '#ff1744', 150);
    spawnParticles(100, 980, 20, '#ff1744', 150);
    spawnParticles(1820, 980, 20, '#ff1744', 150);
  }, 3600);

  // === GO! ===
  setTimeout(() => {
    clearInterval(glitchInterval);
    numEl.textContent = 'GO!';
    numEl.className = 'countdown-number cd-go';
    labelEl.textContent = '';
    subEl.textContent = '';

    // MASSIVE explosion
    screenFlash('rgba(255,255,255,0.5)', 600);
    screenFlash('rgba(255,102,0,0.4)', 800);

    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        spawnParticles(960, 540, 30, ['#ff6600', '#ffea00', '#ff1744', '#00e676', '#2979ff'][i % 5], 400);
      }, i * 80);
    }
    spawnGlitchLines();
    spawnGlitchLines();
    spawnGlitchLines();

    const screen = document.getElementById('screen-countdown');
    screen.classList.add('screen-shake');
    setTimeout(() => screen.classList.remove('screen-shake'), 800);

    // Burst particles from all edges
    for (let i = 0; i < 15; i++) {
      setTimeout(() => {
        spawnParticles(Math.random() * 1920, Math.random() * 1080, 10, '#ff6600', 100);
      }, i * 40);
    }
  }, 5000);
}

// =============================================
// PLAYER ROULETTE
// =============================================
function runRoulette(allPlayers, selected) {
  const roulette = document.getElementById('player-roulette');
  const nameDisplay = document.getElementById('selected-player-name');
  nameDisplay.classList.remove('visible');
  nameDisplay.textContent = '';

  let items = [];
  const totalItems = Math.max(allPlayers.length * 6, 18);
  for (let i = 0; i < totalItems; i++) {
    let candidates = allPlayers.filter(p => items.length === 0 || p.name !== items[items.length - 1].name);
    if (candidates.length === 0) candidates = allPlayers;
    items.push(candidates[Math.floor(Math.random() * candidates.length)]);
  }
  if (items.length > 0 && items[items.length - 1].name === selected.name) {
    const others = allPlayers.filter(p => p.name !== selected.name);
    if (others.length > 0) items[items.length - 1] = others[Math.floor(Math.random() * others.length)];
  }
  items.push(selected);

  roulette.innerHTML = `<div class="roulette-pointer"></div><div class="roulette-track" id="roulette-track"></div>`;
  const track = document.getElementById('roulette-track');

  items.forEach(p => {
    const item = document.createElement('div');
    item.className = 'roulette-item';
    item.textContent = p.name;
    track.appendChild(item);
  });

  const itemWidth = 300;
  const containerWidth = 600;
  const targetOffset = (items.length - 1) * itemWidth - containerWidth / 2 + itemWidth / 2;

  setTimeout(() => { track.style.transform = `translateX(-${targetOffset}px)`; }, 100);

  setTimeout(() => {
    nameDisplay.textContent = selected.name;
    nameDisplay.classList.add('visible');
    const lastItem = track.lastElementChild;
    if (lastItem) lastItem.classList.add('active');
    // Particle burst on reveal
    spawnParticles(960, 450, 30, '#ff6600', 150);
    screenFlash('rgba(255,102,0,0.15)');
  }, 3200);
}

function showPlayerDirect(player) {
  const nameDisplay = document.getElementById('selected-player-name');
  const roulette = document.getElementById('player-roulette');
  roulette.innerHTML = '';
  nameDisplay.textContent = player.name;
  nameDisplay.classList.add('visible');
}

// =============================================
// JOKER ANIMATIONS
// =============================================
function animateJoker5050(hiddenAnswers) {
  const grid = document.getElementById('answers-grid');
  // Flash before hiding
  screenFlash('rgba(255,102,0,0.2)');
  spawnGlitchLines();

  hiddenAnswers.forEach((idx, i) => {
    setTimeout(() => {
      const box = grid.querySelector(`[data-idx="${idx}"]`);
      if (box) {
        box.classList.add('answer-explode');
        const rect = box.getBoundingClientRect();
        spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 15, '#ff6600', 80);
        setTimeout(() => {
          box.classList.remove('answer-explode');
          box.classList.add('hidden-5050');
        }, 400);
      }
    }, i * 300);
  });
}

function animateJokerSkip() {
  screenFlash('rgba(0,150,255,0.2)');
  spawnGlitchLines();
  const qScreen = document.getElementById('screen-question');
  qScreen.classList.add('screen-shake');
  setTimeout(() => qScreen.classList.remove('screen-shake'), 500);
  spawnParticles(960, 540, 50, '#2979ff', 250);
}

function animateJokerDouble() {
  screenFlash('rgba(255,234,0,0.3)', 600);
  const badge = document.getElementById('q-double-badge');
  if (badge) {
    badge.classList.remove('hidden');
    badge.classList.add('double-activate');
    setTimeout(() => badge.classList.remove('double-activate'), 1000);
  }
  spawnParticles(960, 100, 40, '#ffea00', 200);

  // Fire particles from bottom
  for (let i = 0; i < 20; i++) {
    setTimeout(() => {
      spawnParticles(200 + Math.random() * 1520, 1080, 3, '#ff6600', 60);
    }, i * 50);
  }
}

// =============================================
// STEAL UI
// =============================================
function showStealOverlay(player) {
  const overlay = document.getElementById('steal-overlay');
  const nameEl = document.getElementById('steal-player-name');
  nameEl.textContent = player.name;
  overlay.classList.remove('hidden');
  overlay.classList.add('steal-animate');
  screenFlash('rgba(41,121,255,0.3)', 500);
  spawnParticles(960, 540, 40, '#2979ff', 200);
}

function hideStealOverlay() {
  const overlay = document.getElementById('steal-overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('steal-animate');
}

// =============================================
// SOCKET EVENTS
// =============================================
socket.on('stateUpdate', (state) => {
  timerDuration = state.settings ? state.settings.timerDuration : (state.timerDuration || 60);

  // Handle blitz timer override
  if (state.specialType === 'blitz' && state.settings) {
    timerDuration = state.settings.blitzTimer;
  }

  showScreen(state.screen);

  renderPlayers(state.players);
  renderScoreboard(state.players);

  const roundText = `RUNDE ${state.currentRound || 1}/${state.settings ? state.settings.totalRounds : 4}`;
  const roundBadge = document.getElementById('q-round-badge');
  if (roundBadge) roundBadge.textContent = roundText;
  const scoreRound = document.getElementById('scoreboard-round');
  if (scoreRound) scoreRound.textContent = roundText;

  if (state.screen === 'question') {
    renderQuestion(state, 'q');
    updateTimer(state.timerRemaining);
    // Black Ice theme for blitz
    const qScreen = document.getElementById('screen-question');
    qScreen.classList.toggle('blitz-mode', state.specialType === 'blitz');
  }

  if (state.screen === 'reveal') {
    renderQuestion(state, 'r');
    if (!state.stealActive) hideStealOverlay();
    // Black Ice theme for blitz
    const rScreen = document.getElementById('screen-reveal');
    rScreen.classList.toggle('blitz-mode', state.specialType === 'blitz');
  }

  if (state.screen === 'finale') {
    renderFinale(state.players);
  } else {
    finaleStarted = false;
    resetFinaleUI();
  }
});

socket.on('timerTick', (remaining) => {
  updateTimer(remaining);
});

socket.on('answerResult', (data) => {
  showResultBanner(data);

  const revealScreen = document.getElementById('screen-reveal');
  if (data.isCorrect) {
    revealScreen.classList.add('flash-correct');
    setTimeout(() => revealScreen.classList.remove('flash-correct'), 1000);
  } else {
    revealScreen.classList.add('flash-wrong');
    setTimeout(() => revealScreen.classList.remove('flash-wrong'), 1000);
  }
});

socket.on('jokerUsed', ({ type, hiddenAnswers }) => {
  if (type === 'fiftyFifty' && hiddenAnswers) {
    animateJoker5050(hiddenAnswers);
  } else if (type === 'skip') {
    animateJokerSkip();
  } else if (type === 'doublePts') {
    animateJokerDouble();
  }
});

socket.on('playerSelected', ({ player, animate, allPlayers }) => {
  if (animate && allPlayers && allPlayers.length > 1) {
    runRoulette(allPlayers, player);
  } else if (player) {
    showPlayerDirect(player);
  }
});

socket.on('specialRound', ({ type, player }) => {
  showSpecialIntro(type, player);
});

socket.on('startCountdown', () => {
  runGameCountdown();
});

socket.on('stealOffer', ({ player }) => {
  showStealOverlay(player);
});

socket.on('stealResult', ({ success, player, pointsAwarded, correctAnswer, correctAnswerText }) => {
  if (success) {
    screenFlash('rgba(0,230,118,0.3)');
    spawnParticles(960, 540, 50, '#00e676', 250);
  } else {
    screenFlash('rgba(255,23,68,0.2)');
  }

  // Update result banner with correct answer now revealed
  const bannerText = document.getElementById('result-banner-text');
  const bannerSub = document.getElementById('result-banner-sub');
  if (bannerText && bannerSub && correctAnswerText) {
    if (success) {
      bannerText.textContent = 'STEAL ERFOLGREICH!';
      bannerSub.textContent = `${player.name} +${pointsAwarded || 0} PUNKTE`;
    } else {
      bannerText.textContent = 'STEAL FEHLGESCHLAGEN!';
      bannerSub.textContent = `Richtig wäre: ${correctAnswerText}`;
    }
  }

  setTimeout(() => hideStealOverlay(), 1500);
});

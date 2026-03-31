# R6S Quiz Show

A Rainbow Six Siege themed quiz show app built for live streaming / OBS integration. Features a host control panel and a 1920x1080 overlay with dramatic animations, particle effects, and special round types.

## Features

- **Host Panel** (`/host`) — Full control over the quiz flow, player management, settings, and manual overrides
- **OBS Overlay** (`/overlay`) — 1920x1080 animated overlay with screen transitions, particle FX, and glitch effects
- **Slide Flow** — Intro > Players > How-to-Play > Quiz with smooth transitions
- **Fair Rotation** — Every player gets equal turns; fair difficulty and special round distribution
- **Special Rounds**
  - **Blitz** — Short timer, extra points, Black Ice themed visuals
  - **Hardcore** — Expert-only questions, x3 points
  - **Steal** — Wrong answer? Another player can steal the points
- **Jokers** — 50/50, Skip, Double Points with animated effects
- **134 Questions** across 9 R6S categories with difficulty levels (easy/medium/hard/expert)
- **Configurable** — Timer, points, round count, special chances, difficulty multipliers
- **Dramatic Finale** — Countdown, podium reveal with confetti and particle explosions

## Setup

```bash
npm install
npm start
```

Then open:
- **Host Panel**: http://localhost:3000/host
- **OBS Overlay**: http://localhost:3000/overlay

Or just run `dev.bat` on Windows.

## Tech Stack

- Node.js + Express
- Socket.IO (real-time sync between host and overlay)
- Vanilla JS + CSS animations (no frameworks)
- Icons from [game-icons.net](https://game-icons.net)

## Project Structure

```
r6-quiz/
├── server.js              # Game server & Socket.IO logic
├── data/questions.json    # 134 quiz questions (9 categories)
├── public/
│   ├── host/              # Host control panel (HTML/CSS/JS)
│   ├── overlay/           # OBS overlay (HTML/CSS/JS)
│   └── assets/
│       ├── icons/         # SVG icons (game-icons.net)
│       └── operators/     # R6S operator icon SVGs
├── dev.bat                # Windows dev starter
└── package.json
```

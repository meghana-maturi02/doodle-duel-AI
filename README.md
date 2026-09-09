# Doodle Duel AI

A real-time multiplayer drawing game where players draw a prompt and an AI tries to recognize the sketch. The app includes a host/admin flow, player joining, round-based gameplay, score tracking, and final results.

## Features

- Create or join a game room
- Host/admin controls for managing the match
- Player drawing canvas with timer-based rounds
- AI-powered recognition and score evaluation
- Live leaderboard and final winner screen
- Firebase-powered real-time state sync

## Tech Stack

- React
- Vite
- TypeScript
- Tailwind CSS
- Firebase
- HTML5 Canvas
- JavaScript/React Hooks

## Project Structure

```bash
src/
  App.tsx
  GameManager.tsx
  main.tsx
  index.css
  services/
    firebase.ts
    quickDrawAPI.ts
    roomService.ts
public/
.env
package.json
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_DATABASE_URL=your_database_url
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

> The app depends on these Firebase environment variables to connect to your backend and real-time game state.

3. Start the development server:

```bash
npm run dev
```

4. Open the local URL shown in the terminal, usually:

```bash
http://localhost:5173
```

## Production Build

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## Linting

```bash
npm run lint
```

## Notes

- The app is designed for local multiplayer-style gameplay in a browser.
- Firebase is used for room management, user flow, and game state updates.
- The AI result flow depends on your configured recognition and game logic.

## License

This project is currently unlicensed unless you add a custom license.

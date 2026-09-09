import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

/**
 * Firebase configuration.
 *
 * All values come from a `.env` file (see `.env.example`). Vite exposes
 * env variables prefixed with VITE_ to the client bundle.
 *
 * Firebase web API keys are NOT secrets — they identify your project and
 * access is controlled by Security Rules + Authorized Domains, which makes
 * them safe to ship in a public web app.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

/** True when every required env var is present. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId
);

let app: FirebaseApp | null = null;
let db: Database | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} else {
  console.warn(
    '[DoodleDuel] Firebase env vars missing — falling back to cross-tab sync. ' +
      'Copy .env.example to .env and fill in your Firebase keys for multi-device play.'
  );
}

export { app, db };
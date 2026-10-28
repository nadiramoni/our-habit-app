// Baked-in Firebase config for the APK/static build.
// The GitHub Actions workflow replaces `null` with the owner's firebaseConfig
// JSON (from the FIREBASE_CONFIG secret) so the APK connects to the owner's
// own Firebase without needing any server.
//
// ✅ REAL config pasted by the owner (project: our-habit-61587) — 2026-10-28
// This is also the fallback when no server is reachable (APK offline-first).
export const BAKED_FIREBASE: string | null =
  '{"apiKey":"AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY","authDomain":"our-habit-61587.firebaseapp.com","projectId":"our-habit-61587","storageBucket":"our-habit-61587.firebasestorage.app","messagingSenderId":"570611135763","appId":"1:570611135763:web:11f7f2bf7a5f20825696e6","measurementId":"G-Y66D0DQCQK"}';

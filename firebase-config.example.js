// Firebase Configuration Example
// Copy this file to 'firebase-config.js' and fill in your actual Firebase Web App credentials.
// For testing without Firebase, the application automatically runs in "Demo / Local Storage" fallback mode.

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

if (typeof window !== "undefined") {
  window.firebaseConfig = firebaseConfig;
}

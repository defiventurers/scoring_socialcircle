// Firebase Configuration
// Replace these with your actual Firebase Web App credentials.
// If left as is, the application will automatically run in "Local Demo Mode" using LocalStorage.

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

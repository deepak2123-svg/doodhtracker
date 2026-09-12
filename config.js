// Paste the config object Firebase gives you when you register a Web App.
// Firebase console -> Project settings -> General -> Your apps -> Web app -> Config
// This is safe to keep public in your repo; Firestore security rules are what
// actually protect your data (see firestore.rules in this folder).

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

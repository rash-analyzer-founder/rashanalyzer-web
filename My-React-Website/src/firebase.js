// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, where, serverTimestamp, doc, setDoc, deleteDoc } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
const googleProvider = new GoogleAuthProvider();

const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
const logout = () => signOut(auth);

export { db, auth, storage, storageRef, uploadBytes, getDownloadURL, collection, addDoc, onSnapshot, query, orderBy, where, serverTimestamp, signInWithGoogle, logout, onAuthStateChanged, doc, setDoc, deleteDoc };

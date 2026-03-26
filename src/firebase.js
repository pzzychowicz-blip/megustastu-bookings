import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAliFpmNhdZjaix-EecY_0ZN99m0dktL-s",
  authDomain: "megustastu-bookings.firebaseapp.com",
  databaseURL: "https://megustastu-bookings-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "megustastu-bookings",
  storageBucket: "megustastu-bookings.firebasestorage.app",
  messagingSenderId: "263618028611",
  appId: "1:263618028611:web:c851ef6291387a895020f6",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

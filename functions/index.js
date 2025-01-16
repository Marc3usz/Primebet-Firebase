const KEY = require("./key/primebet-c1eed-firebase-adminsdk-qiz1l-c46dda942d.json"); // DO NOT ADD THIS FILE TO GIT TRACKING

const auth = require("firebase-functions/v1/auth");
const admin = require("firebase-admin");

admin.initializeApp({credential: admin.credential.cert(KEY)});

const firestore = admin.firestore();

// Funkcja wywoływana przy utworzeniu nowego użytkownika
exports.createUser = auth.user().onCreate(async user => {
    try {
        const date = admin.firestore.FieldValue.serverTimestamp();
        await firestore.collection("Users").doc(user.uid).set({
            credits: 1000,
            creationDate: date,
            bets: [],
        });
        console.log(`Użytkownik ${user.uid} został poprawnie dodany.`);
    } catch (error) {
        console.error("Błąd podczas tworzenia użytkownika:", error);
    }
});
const KEY = require("./key/primebet-c1eed-firebase-adminsdk-qiz1l-c46dda942d.json"); // DO NOT ADD THIS FILE TO GIT TRACKING

const auth = require("firebase-functions/v1/auth");
const admin = require("firebase-admin");

admin.initializeApp({credential: admin.credential.cert(KEY)});

const firestore = admin.firestore();
const API_KEY_ODDSAPI = require("./key/ODDSAPI_KEY.json").key;

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


const functions = require('firebase-functions');
const axios = require('axios');

const CACHE_COLLECTION = 'api_cache';
const CACHE_TTL_MS = 3600000; // 1 hour in milliseconds
const db = firestore

exports.fetchBookmakerOdds = functions.https.onRequest(async (req, res) => {
  const apiUrl = `https://api.the-odds-api.com/v4/sports/upcoming/odds/?regions=eu&markets=h2h&apiKey=${API_KEY_ODDSAPI}`

  const cacheDocRef = db.collection(CACHE_COLLECTION).doc(cacheKey);

  try {
    // Check if data is cached
    const cachedData = await cacheDocRef.get();
    if (cachedData.exists) {
      const cachedTimestamp = cachedData.data().timestamp;
      if (Date.now() - cachedTimestamp < CACHE_TTL_MS) {
        // Data is cached and not expired
        return res.status(200).send(cachedData.data().data);
      }
    }

    // Data is not cached or expired, fetch from API
    const apiResponse = await axios.get(apiUrl);
    const apiData = apiResponse.data;

    // Cache the data
    await cacheDocRef.set({
      data: apiData,
      timestamp: Date.now(),
    });

    // Return the data to the user
    return res.status(200).send(apiData);
  } catch (error) {
    console.error('Error fetching or caching API data:', error);
    return res.status(500).send('Error fetching API data');
  }
});
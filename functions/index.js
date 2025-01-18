const KEY = require("./key/primebet-c1eed-firebase-adminsdk-qiz1l-c46dda942d.json"); // DO NOT ADD THIS FILE TO GIT TRACKING

const auth = require("firebase-functions/v1/auth");
const admin = require("firebase-admin");
const cors = require("cors");
const corsHandler = cors({ origin: true });

admin.initializeApp({ credential: admin.credential.cert(KEY) });

const firestore = admin.firestore();
const API_KEY_ODDSAPI = require("./key/ODDSAPI_KEY.json").key;

exports.createUser = auth.user().onCreate(async (user) => {
    try {
        const date = admin.firestore.FieldValue.serverTimestamp();

        const userDocRef = firestore.collection("Users").doc(user.uid);

        await userDocRef.set({
            credits: 1000,
            creationDate: date,
        });

        const tmp = userDocRef.collection("bets").doc();
        await tmp.delete();

        console.log(`Użytkownik ${user.uid} został poprawnie dodany.`);
    } catch (error) {
        console.error("Błąd podczas tworzenia użytkownika:", error);
    }
});

const functions = require("firebase-functions");
const axios = require("axios");

const CACHE_COLLECTION = "api_cache";
const CACHE_TTL_MS = 3600000; // 1 hour in milliseconds
const db = firestore;

exports.fetchBookmakerOdds = functions.https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        const endpoint = `sports/upcoming/odds/?regions=eu&markets=h2h`;
        const apiUrl = `https://api.the-odds-api.com/v4/${endpoint}&apiKey=${API_KEY_ODDSAPI}`;

        const cacheDocRef = db
            .collection(CACHE_COLLECTION)
            .doc(Buffer.from(endpoint).toString("base64"));

        try {
            // Check if data is cached
            const cachedData = await cacheDocRef.get();
            if (cachedData.exists) {
                const cachedTimestamp = cachedData.data().timestamp;
                if (Date.now() - cachedTimestamp < CACHE_TTL_MS) {
                    // Data is cached and not expired
                    return res
                        .status(200)
                        .send({ data: cachedData.data().data });
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
            return res.status(200).send({ data: apiData });
        } catch (error) {
            console.error("Error fetching or caching API data:", error);
            return res.status(500).send({ data: "Error fetching API data" });
        }
    });
});

const verifyBet = (bet) => {
    const id = bet.id ?? false;
    const home_team = bet.home_team ?? false;
    const away_team = bet.away_team ?? false;
    const commence_time = bet.commence_time ?? false;
    const odds = bet.odds ?? false;
    const prediction = bet.prediction ?? false;
    const status = "unsettled";
    return id && home_team && away_team && commence_time && odds && prediction
        ? {
              id,
              home_team,
              away_team,
              commence_time,
              odds,
              status,
              prediction,
          }
        : null;
};

const verifyBetslip = (betslip) => {
    const bet_amount = betslip.bet_amount ?? false;
    const games = betslip.games ?? [];
    let errorCount = -1;
    let calculatedOdds = 1;
    for (const bet of games) {
        if (errorCount == -1) errorCount++;
        const verifiedBet = verifyBet(bet);
        if (!(verifiedBet ?? false)) errorCount++;
        if (errorCount > 0) return null;
        calculatedOdds *= verifiedBet.odds;
    }
    return bet_amount && games
        ? {
              status: "unsettled",
              bet_amount,
              odds: Math.floor(calculatedOdds * 100) / 100,
              games,
          }
        : null;
};

exports.buyBet = functions.https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res
                    .status(401)
                    .send({
                        data: "Unauthorized request: Missing or invalid token",
                    });
            }

            const bearerToken = authHeader.split("Bearer ")[1];
            const decodedToken = await admin.auth().verifyIdToken(bearerToken);
            const uid = decodedToken.uid;

            const userBetDocRef = db
                .collection("Users")
                .doc(uid)
                .collection("bets")
                .doc();

            const userDocRef = db.collection("Users").doc(uid);
            const userData = (await userDocRef.get()).data() ?? { credits: 0 };
            const submitted = req.body.data;
            const validated = verifyBetslip(submitted) ?? false;

            if (!validated) {
                return res.status(422).send({ data: "Invalid Request" });
            } else {
                if (validated.bet_amount > userData.credits)
                    return res.status(422).send({ data: "Insufficient funds" });

                const writeBatch = db.batch();

                writeBatch.update(userDocRef, {
                    credits: userData.credits - validated.bet_amount,
                });
                writeBatch.set(userBetDocRef, validated);

                await writeBatch.commit();

                return res.status(200).send({
                    data: "document successfully added",
                    id: userBetDocRef.id,
                });
            }
        } catch (e) {
            console.error(e.message);
            console.error(e.stack);
            return res.status(500).send({ data: `Error occured: ${e}` });
        }
    });
});

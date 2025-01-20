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
            wager: 0,
            wins: 0,
            losses: 0,
            lost: 0,
            won: 0,
            luckiest_win: 0,
        });

        console.log(`Użytkownik ${user.uid} został poprawnie dodany.`);
    } catch (error) {
        console.error("Błąd podczas tworzenia użytkownika:", error);
    }
});

const functions = require("firebase-functions");
const axios = require("axios");
const { onSchedule } = require("firebase-functions/scheduler");

const CACHE_COLLECTION = "api_cache";
const CACHE_TTL_MS = 3600000; // 1 hour in milliseconds

function filterUnstartedGames(games) {
    const currentTime = new Date().toISOString();
    return games.filter(game => new Date(game.commence_time) > new Date(currentTime));
}

exports.fetchBookmakerOdds = functions.https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        const endpoint = `sports/upcoming/odds/?regions=eu&markets=h2h`;
        const apiUrl = `https://api.the-odds-api.com/v4/${endpoint}&apiKey=${API_KEY_ODDSAPI}`;

        const cacheDocRef = firestore
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
                        .send({ data: filterUnstartedGames(cachedData.data().data) });
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

            // Return the unstarted games to the user
            return res.status(200).send({ data: filterUnstartedGames(apiData) });
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
    const name = bet.name ?? false;
    const status = "unsettled";
    const sport_key = bet.sport_key;
    return id &&
        home_team &&
        away_team &&
        commence_time &&
        odds &&
        prediction &&
        name &&
        sport_key
        ? {
              id,
              home_team,
              away_team,
              commence_time,
              odds,
              status,
              prediction,
              name,
              sport_key,
          }
        : null;
};

const verifyBetslip = (betslip) => {
    const bet_amount = betslip.bet_amount ?? false;
    const games = betslip.games ?? [];
    let newGame = [];
    let errorCount = -1;
    let calculatedOdds = 1;
    for (const bet of games) {
        if (errorCount == -1) errorCount++;
        const verifiefirestoreet = verifyBet(bet);
        if (!(verifiefirestoreet ?? false)) errorCount++;
        if (errorCount > 0) return null;
        calculatedOdds *= verifiefirestoreet.odds;
        newGame = [...newGame, verifiefirestoreet];
    }
    return bet_amount && games && errorCount === 0
        ? {
              status: "unsettled",
              bet_amount,
              odds: Math.floor(calculatedOdds * 100) / 100,
              games: newGame,
          }
        : null;
};

exports.buyBet = functions.https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res.status(401).send({
                    data: "Unauthorized request: Missing or invalid token",
                });
            }

            const bearerToken = authHeader.split("Bearer ")[1];
            const decodedToken = await admin.auth().verifyIdToken(bearerToken);
            const uid = decodedToken.uid;

            console.log("auth ok, id: ", uid);

            const userBetDocRef = firestore
                .collection("Users")
                .doc(uid)
                .collection("bets")
                .doc();

            console.log("getting bets collection ok");

            const userDocRef = firestore.collection("Users").doc(uid);
            const userData = (await userDocRef.get()).data() ?? { credits: 0 };
            const submitted = req.body.data;
            console.log(submitted);
            const validated = verifyBetslip(submitted) ?? false;
            console.log(validated);

            if (!validated) {
                return res.status(422).send({ data: "Invalid Request" });
            } else {
                if (validated.bet_amount > userData.credits)
                    return res.status(422).send({ data: "Insufficient funds" });

                const writeBatch = firestore.batch();

                // Ensure the betslip document exists
                const betslipDocRef = firestore
                    .collection("betslip_indexing")
                    .doc(uid);

                // Create the document if it doesn't exist (this doesn't overwrite)
                await betslipDocRef.set({}, { merge: true });

                // Reference to the 'games' subcollection in the betslip
                const betslip_indexing = betslipDocRef.collection("games");

                for (const game of validated.games) {
                    betslip_indexing
                        .doc(game.id)
                        .set({ sport_key: game.sport_key }); // Add game to subcollection
                }

                // Update the user's credits and wager values
                writeBatch.update(userDocRef, {
                    credits: userData.credits - validated.bet_amount,
                    wager: userData.wager + validated.bet_amount,
                });

                // Set the bet details
                writeBatch.set(userBetDocRef, validated);

                // Commit the batch
                await writeBatch.commit();

                return res.status(200).send({
                    data: "Document successfully added",
                    id: userBetDocRef.id,
                });
            }
        } catch (e) {
            console.error(e.message);
            console.error(e.stack);
            return res.status(500).send({ data: `Error occurred: ${e}` });
        }
    });
});

exports.scheduledGameIndexing = onSchedule("every 12 hours", async (context) => {
    console.log("Starting scheduled game indexing...");
    try {
        const betslipRef = firestore.collection("betslip_indexing");
        const gameIndexRef = firestore.collection("game_indexing");

        // Fetch all documents from betslip_indexing collection
        const betslipSnapshot = await betslipRef.get();

        if (betslipSnapshot.empty) {
            console.log("No betslip documents found.");
            return null;
        }

        const aggregatedSportKeys = new Set();

        // Iterate over betslip documents
        for (const betslipDoc of betslipSnapshot.docs) {
            const uid = betslipDoc.id;
            const gamesRef = betslipDoc.ref.collection("games");

            // Fetch games from the subcollection
            const gamesSnapshot = await gamesRef.get();
            if (gamesSnapshot.empty) {
                console.log(`No games found for betslip ${uid}`);
                continue;
            }

            for (const gameDoc of gamesSnapshot.docs) {
                const gameData = gameDoc.data();
                const sportKey = gameData.sport_key;

                if (!sportKey) {
                    console.log(
                        `Missing sport_key for game ${gameDoc.id} in betslip ${uid}`
                    );
                    continue;
                }

                aggregatedSportKeys.add(sportKey);

                // Check if the document already exists in the game_indexing collection
                const gameIndexDocRef = gameIndexRef.doc(gameDoc.id);
                const gameIndexDoc = await gameIndexDocRef.get();

                if (!gameIndexDoc.exists) {
                    // Create the document in game_indexing
                    await gameIndexDocRef.set({
                        result: "pending", // Default result field
                        sport_key: sportKey, // Include the sport_key for better querying
                    });
                    console.log(`Added game ${gameDoc.id} to game_indexing`);
                } else {
                    console.log(`Game ${gameDoc.id} already exists in game_indexing`);
                }
            }
        }

        // Fetch and update game results using the API
        for (const sportKey of aggregatedSportKeys) {
            const apiUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?daysFrom=1&apiKey=${API_KEY_ODDSAPI}`;
            try {
                const response = await axios.get(apiUrl);
                const gameScores = response.data;

                for (const game of gameScores) {
                    if (game.completed) {
                        const gameIndexDocRef = gameIndexRef.doc(game.id);

                        // Determine the winner
                        const scores = game.scores || [];
                        const winningTeam =
                            scores.length === 2 && scores[0].score > scores[1].score
                                ? scores[0].name
                                : scores[1]?.name || "draw";

                        await gameIndexDocRef.update({
                            result: winningTeam,
                        });

                        console.log(`Updated game ${game.id} with result: ${winningTeam}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch data for sport key ${sportKey}:`, error.message);
            }
        }

        // NEW CODE: Iterate through each user's betslips and update their statuses
        for (const betslipDoc of betslipSnapshot.docs) {
            const uid = betslipDoc.id; // User ID
            const betsCollectionRef = firestore
                .collection("Users")
                .doc(uid)
                .collection("bets");

            const betslipsSnapshot = await betsCollectionRef.get(); // Fetch user betslips
            if (betslipsSnapshot.empty) {
                console.log(`No betslips found for user ${uid}`);
                continue;
            }

            for (const betslipDoc of betslipsSnapshot.docs) {
                const betslipData = betslipDoc.data();
                const games = betslipData.games || [];

                let allResolved = true;
                let allWon = true;
                let totalWinnings = 0; // Variable to accumulate the winnings
                let betslipOdds = 1; // Variable to store the combined odds of the betslip

                // Iterate through each game in the betslip
                for (const game of games) {
                    const gameIndexDocRef = gameIndexRef.doc(game.id);
                    const gameIndexDoc = await gameIndexDocRef.get();

                    if (!gameIndexDoc.exists) {
                        console.log(`Game ${game.id} does not exist in game_indexing`);
                        continue;
                    }

                    const gameIndexData = gameIndexDoc.data();
                    if (gameIndexData.result === "pending") {
                        allResolved = false;
                    } else if (gameIndexData.result !== game.prediction) {
                        allWon = false;
                    }

                    // Update the individual game's status
                    const gameStatus =
                        gameIndexData.result === "pending"
                            ? "unsettled"
                            : gameIndexData.result === game.prediction
                            ? "won"
                            : "lost";

                    game.status = gameStatus;

                    // If the game is won, accumulate the winnings
                    if (game.status === "won") {
                        totalWinnings += game.odds * game.amount;
                    }

                    // Calculate combined odds for the betslip
                    betslipOdds *= game.odds;
                }

                // Update the betslip's status based on the game's resolutions
                if (allResolved) {
                    betslipData.status = allWon ? "won" : "lost";
                } else {
                    betslipData.status = "unsettled";
                }

                // Save the updated betslip back to Firestore
                await betsCollectionRef.doc(betslipDoc.id).update(betslipData);

                // Now, update the user's stats if the betslip is settled
                if (betslipData.status === "won") {
                    // Add the winnings to the user's credits
                    const userDocRef = firestore.collection("Users").doc(uid);
                    const userData = (await userDocRef.get()).data() ?? { credits: 0, wins: 0, losses: 0, luckiest_win: 0 };

                    // Update the user's credits and win count
                    const newCredits = userData.credits + totalWinnings;
                    const newWins = userData.wins + 1;

                    // Update the user's luckiest win if applicable
                    const newLuckiestWin = totalWinnings > userData.luckiest_win ? totalWinnings : userData.luckiest_win;

                    // Update the user's document with the new values
                    await userDocRef.update({
                        credits: newCredits,
                        wins: newWins,
                        luckiest_win: newLuckiestWin,
                    });
                } else if (betslipData.status === "lost") {
                    // Increment the loss count if the betslip is lost
                    const userDocRef = firestore.collection("Users").doc(uid);
                    const userData = (await userDocRef.get()).data() ?? { credits: 0, wins: 0, losses: 0, luckiest_win: 0 };
                    const newLosses = userData.losses + 1;

                    // Update the user's loss count
                    await userDocRef.update({
                        losses: newLosses,
                    });
                }
            }
        }

        console.log("Game indexing task completed.");
        return null;
    } catch (error) {
        console.error("Error in scheduledGameIndexing function:", error);
        throw new functions.https.HttpsError("internal", "Game indexing failed.");
    }
});



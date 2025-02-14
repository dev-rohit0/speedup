const WebSocket = require("ws");

const server = new WebSocket.Server({ port: 3000 });

let rooms = {}; // Stores active rooms

// Send data to all players in a room
function sendToRoom(roomCode, data) {
    if (rooms[roomCode]) {
        rooms[roomCode].clients.forEach(client => {
            if (client.socket.readyState === WebSocket.OPEN) {
                client.socket.send(JSON.stringify(data));
            }
        });
    }
}

// Generate a math question based on difficulty level
function sendNewQuestion(roomCode) {
    let num1, num2, answer;
    let operators = ["+", "-", "*", "/"];
    let operator = operators[Math.floor(Math.random() * operators.length)];

    const difficulty = rooms[roomCode].difficulty;
    let min, max;

    switch (difficulty) {
        case "basic":
            min = 1;
            max = 9;
            break;
        case "medium":
            min = 10;
            max = 99;
            break;
        case "advanced":
            min = 100;
            max = 999;
            break;
        default:
            min = 1;
            max = 9;
    }

    do {
        num1 = Math.floor(Math.random() * (max - min + 1)) + min;
        num2 = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (operator === "/" && num1 % num2 !== 0); // Ensure integer division

    switch (operator) {
        case "+": answer = num1 + num2; break;
        case "-": 
            if (num1 < num2) [num1, num2] = [num2, num1]; // Ensure non-negative result
            answer = num1 - num2; 
            break;
        case "*": answer = num1 * num2; break;
        case "/": answer = Math.floor(num1 / num2); break;
    }

    rooms[roomCode].currentQuestion = { question: `${num1} ${operator} ${num2}`, answer };
    rooms[roomCode].questionStartTime = Date.now(); // Record the start time of the question

    // Send the new question to all players
    sendToRoom(roomCode, { type: "new-question", question: rooms[roomCode].currentQuestion.question });

    // Start a 20-second timer for the question
    rooms[roomCode].questionTimer = setTimeout(() => {
        if (rooms[roomCode]) {
            sendToRoom(roomCode, { type: "time-up" });
            sendNewQuestion(roomCode); // Generate a new question
        }
    }, 20000);
}

// Generate a unique room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Get the leaderboard
function getLeaderboard(roomCode) {
    return Object.entries(rooms[roomCode].scores)
        .map(([name, score]) => ({ name, score }))
        .sort((a, b) => b.score - a.score);
}

// WebSocket server connection
server.on("connection", (socket) => {
    console.log("A new client connected!");

    socket.on("message", (message) => {
        let data = JSON.parse(message);

        if (data.type === "create-room") {
            let roomCode = generateRoomCode();
            rooms[roomCode] = { 
                clients: [], 
                scores: {}, 
                currentQuestion: null, 
                difficulty: data.difficulty || "basic" 
            };
            rooms[roomCode].clients.push({ socket, username: data.username });
            rooms[roomCode].scores[data.username] = 0;

            socket.send(JSON.stringify({ type: "room-joined", roomCode }));
            console.log(`Room ${roomCode} created by ${data.username} with difficulty ${data.difficulty}`);
        
        } else if (data.type === "join-room") {
            let roomCode = data.roomCode;
            if (!rooms[roomCode]) {
                socket.send(JSON.stringify({ type: "error", message: "Room does not exist!" }));
                return;
            }
            if (rooms[roomCode].clients.some(client => client.username === data.username)) {
                socket.send(JSON.stringify({ type: "error", message: "Username already taken in this room!" }));
                return;
            }
            rooms[roomCode].clients.push({ socket, username: data.username });
            rooms[roomCode].scores[data.username] = 0;
            socket.send(JSON.stringify({ type: "room-joined", roomCode }));

            sendToRoom(roomCode, { type: "player-joined", players: getLeaderboard(roomCode) });
            console.log(`${data.username} joined Room ${roomCode}`);

        } else if (data.type === "start-game") {
            let roomCode = data.roomCode;
            if (!rooms[roomCode]) return;
            
            sendNewQuestion(roomCode);
            console.log(`Game started in Room ${roomCode}`);

        } else if (data.type === "answer") {
            let roomCode = data.roomCode;
            let userAnswer = parseInt(data.answer);

            if (!rooms[roomCode]?.currentQuestion) {
                socket.send(JSON.stringify({ type: "error", message: "No active question!" }));
                return;
            }

            let currentQuestion = rooms[roomCode].currentQuestion;

            if (userAnswer === currentQuestion.answer) {
                const timeTaken = Date.now() - rooms[roomCode].questionStartTime;
                const remainingTime = Math.max(0, 20000 - timeTaken); // 20 seconds timer
                const points = Math.floor(remainingTime / 1000); // Points equal to remaining seconds

                rooms[roomCode].scores[data.username] += points;

                sendToRoom(roomCode, {
                    type: "correct-answer",
                    correctPlayer: data.username,
                    leaderboard: getLeaderboard(roomCode),
                    points
                });

                // Clear the existing timer
                clearTimeout(rooms[roomCode].questionTimer);

                // Generate a new question after the correct answer
                sendNewQuestion(roomCode);
                console.log(`${data.username} answered correctly in Room ${roomCode} and earned ${points} points`);
            } else {
                socket.send(JSON.stringify({ type: "incorrect-answer", message: "Wrong answer, try again!" }));
            }
        }
    });

    socket.on("close", () => {
        console.log("A client disconnected.");

        Object.keys(rooms).forEach(roomCode => {
            let room = rooms[roomCode];

            // Find the disconnected player
            let disconnectedPlayer = room.clients.find(client => client.socket === socket);
            if (disconnectedPlayer) {
                let username = disconnectedPlayer.username;

                // Remove player from room
                room.clients = room.clients.filter(client => client.socket !== socket);
                delete room.scores[username];

                console.log(`${username} left Room ${roomCode}`);

                // Notify remaining players about the updated leaderboard
                sendToRoom(roomCode, {
                    type: "player-left",
                    players: getLeaderboard(roomCode),
                });

                // If the room is empty, delete it
                if (room.clients.length === 0) {
                    clearTimeout(room.questionTimer); // Clear the timer
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} is empty and removed.`);
                }
            }
        });
    });
});

console.log("WebSocket server running on ws://localhost:3000");

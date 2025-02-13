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

// Generate a math question with integer division handling
function sendNewQuestion(roomCode) {
    let num1, num2, answer;
    let operators = ["+", "-", "*", "/"];
    let operator = operators[Math.floor(Math.random() * operators.length)];

    do {
        num1 = Math.floor(Math.random() * 100) + 1;
        num2 = Math.floor(Math.random() * 100) + 1;
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

    sendToRoom(roomCode, { type: "new-question", question: rooms[roomCode].currentQuestion.question });
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
            rooms[roomCode] = { clients: [], scores: {}, currentQuestion: null };
            rooms[roomCode].clients.push({ socket, username: data.username });
            rooms[roomCode].scores[data.username] = 0;

            socket.send(JSON.stringify({ type: "room-joined", roomCode }));
            console.log(`Room ${roomCode} created by ${data.username}`);
        
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
                rooms[roomCode].scores[data.username] += 10;
                sendToRoom(roomCode, {
                    type: "correct-answer",
                    correctPlayer: data.username,
                    leaderboard: getLeaderboard(roomCode)
                });

                // Generate a new question after the correct answer
                sendNewQuestion(roomCode);
                console.log(`${data.username} answered correctly in Room ${roomCode}`);
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
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} is empty and removed.`);
                }
            }
        });
    });
});

console.log("WebSocket server running on ws://localhost:3000");

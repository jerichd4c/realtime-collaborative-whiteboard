const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Frontend goes in public folder
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Join room directly
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId;
        console.log(`Usuario ${socket.id} se unió a la sala: ${roomId}`);
        socket.to(roomId).emit('user-connected', socket.id);
    });

    // WebRTC trade
    socket.on('offer', (data) => {
        socket.to(data.targetId).emit('offer', { sdp: data.sdp, senderId: socket.id });
    });

    socket.on('answer', (data) => {
        socket.to(data.targetId).emit('answer', { sdp: data.sdp, senderId: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.targetId).emit('ice-candidate', { candidate: data.candidate, senderId: socket.id }); 
    });

    // Board events 
    socket.on('draw-action', (data) => {
        // Resends boards actions to the rest of the room
        socket.to(data.roomId).emit('draw-action', data);
    });

    socket.on('move-action', (data) => {
        // Broadcast shape move to the rest of the room
        socket.to(data.roomId).emit('move-action', data);
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.id);
        } 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de pizarra corriendo en http://localhost:${PORT}`);
});
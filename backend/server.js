const io = require("socket.io")(5000, {
  cors: {
    origin: "*",
  },
});

// Store room data
const rooms = new Map(); // { roomId: { participants: [socketId], offers: [], answers: [] } }

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // Listen for user joining
  socket.on("join_room", (data) => {
    const { roomId } = data;

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { participants: [], offers: [], answers: [], iceCandidates: [], });
    }

    const room = rooms.get(roomId);

    // Add user to the room
    room.participants.push(socket.id);
    socket.join(roomId);
    console.log(`User (ID: ${socket.id}) joined room: ${roomId}`);

    // Notify other users in the room
    socket.to(roomId).emit("user_joined", { socketId: socket.id });
  });

  // Listen for new offers
  socket.on("start_call", (data) => {
    const { roomId, offer,targetId  } = data;
    console.log(`Call initiated in room ${roomId} to target ${targetId}`);

    const room = rooms.get(roomId);

    if (!room) {
      console.error(`Room ${roomId} not found.`);
      return;
    }

    // Add offer to the room
    room.offers.push({ socketId: socket.id, offer });

    // Broadcast the offer to all other participants
    io.to(targetId).emit("incoming_call", { offer, callerId: socket.id });
  });

// Listen for new answers
socket.on("accept_call", (data, ackFunction) => {
  const { roomId, answer, callerId } = data;
  console.log(`Call accepted in room: ${roomId}`);

  const room = rooms.get(roomId);
  if (!room) {
    console.error(`Room ${roomId} not found.`);
    return;
  }

  // Add answer to the room
  room.answers.push({ socketId: socket.id, answer, callerId });

  // Send the answer to the caller
  io.to(callerId).emit("call_accepted", { answer, calleeId: socket.id });

  // Send back existing ICE candidates to the answerer
  if (typeof ackFunction === "function") {
    const candidates = room.iceCandidates
      .filter((candidate) => candidate.senderId === callerId)
      .map((candidate) => ({
        candidate: candidate.candidate.candidate,
        sdpMid: candidate.candidate.sdpMid || "0", // Default value if missing
        sdpMLineIndex: candidate.candidate.sdpMLineIndex || 0, // Default value if missing
      }));
    ackFunction(candidates);
  }
});

  // Listen for ICE candidates
  socket.on("ice-candidate", (data) => {
    const { roomId, candidate, targetId } = data;
  
    const room = rooms.get(roomId);
    if (!room) {
      console.error(`Room ${roomId} not found.`);
      return;
    }
  
    // Store ICE candidate
    room.iceCandidates.push({ senderId: socket.id, candidate });
  
    // Send ICE candidate to the target user
    if (targetId) {
      io.to(targetId).emit("ice-candidate", {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || "0", // Default value if missing
        sdpMLineIndex: candidate.sdpMLineIndex || 0, // Default value if missing
        senderId: socket.id,
      });
    } else {
      // Broadcast to all participants in the room
      socket.to(roomId).emit("ice-candidate", {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || "0", // Default value if missing
        sdpMLineIndex: candidate.sdpMLineIndex || 0, // Default value if missing
        senderId: socket.id,
      });
    }
  });

  // Listen for hangup
  socket.on("hangup", (data) => {
    const { roomId } = data;
    console.log(`User in room ${roomId} hung up`);

    const room = rooms.get(roomId);
    if (room) {
      // Clean up offers and answers for this user
      room.offers = room.offers.filter((offer) => offer.socketId !== socket.id);
      room.answers = room.answers.filter((answer) => answer.socketId !== socket.id);

      // Notify other users in the room
      socket.to(roomId).emit("hangup", { socketId: socket.id });
    }
  });

  // Listen for disconnect
  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);

    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      room.participants = room.participants.filter((id) => id !== socket.id);
      room.offers = room.offers.filter((offer) => offer.socketId !== socket.id);
      room.answers = room.answers.filter((answer) => answer.socketId !== socket.id);

      // Notify other users in the room
      if (room.participants.length > 0) {
        io.to(roomId).emit("user_left", { socketId: socket.id });
      } else {
        // Delete the room if empty
        rooms.delete(roomId);
      }
    });
  });

  // Handle leave_room event
  socket.on("leave_room", (data) => {
    const { roomId } = data;
    console.log(`User ${socket.id} left room: ${roomId}`);

    const room = rooms.get(roomId);
    if (room) {
      // Remove user from the room
      room.participants = room.participants.filter((id) => id !== socket.id);
      room.offers = room.offers.filter((offer) => offer.socketId !== socket.id);
      room.answers = room.answers.filter((answer) => answer.socketId !== socket.id);

      // Notify other users in the room
      socket.to(roomId).emit("user_left", { socketId: socket.id });

      // Delete the room if empty
      if (room.participants.length === 0) {
        rooms.delete(roomId);
      }
    }

    socket.leave(roomId);
  });

  // Handle reject_call event
  socket.on("reject_call", (data) => {
    const { roomId } = data;
    console.log(`Call rejected in room: ${roomId}`);

    const room = rooms.get(roomId);
    if (room) {
      // Clean up offers for this room
      room.offers = room.offers.filter((offer) => offer.socketId !== socket.id);
    }

    socket.to(roomId).emit("call_rejected", { socketId: socket.id });
  });
});
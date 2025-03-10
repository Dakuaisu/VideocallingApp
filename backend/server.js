const io = require("socket.io")(5000, {
  cors: {
    origin: "*",
  },
});

// Store offers and connected sockets
const offers = []; // { roomId, offer, offerIceCandidates, answer, answererIceCandidates }
const connectedSockets = []; // { socketId, roomId }

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // Listen for user joining
  socket.on("join_room", (data) => {
    const { roomId } = data;
    const room = io.sockets.adapter.rooms.get(roomId);

    // Ensure only 2 users per room
    if (room && room.size >= 2) {
      socket.emit("room_full", { roomId });
      return;
    }

    socket.join(roomId);
    console.log(`User (ID: ${socket.id}) joined room: ${roomId}`);

    // Add user to connectedSockets
    connectedSockets.push({ socketId: socket.id, roomId });
  });

  // Listen for new offers
  socket.on("start_call", (data) => {
    const { roomId, offer } = data;
    console.log(`Call initiated in room ${roomId}`);

    const existingOffer = offers.find((o) => o.roomId === roomId);
    if (existingOffer) {
      console.warn(`Offer already exists for room ${roomId}, skipping duplicate`);
      return;
    }

    // Add offer to the list
    offers.push({
      roomId,
      offer,
      offerIceCandidates: [],
      answer: null,
      answererIceCandidates: [],
    });

     // Debugging

    // Notify other users in the room
    socket.to(roomId).emit("incoming_call", { offer });
  });

  // Listen for new answers
  socket.on("accept_call", (data, ackFunction) => {
    const { roomId, answer } = data;
    console.log(`Call accepted in room: ${roomId}`);

    // Find the offer to update
    const offerToUpdate = offers.find(
      (o) => o.roomId === roomId && o.answer === null
    );

    if (!offerToUpdate) {
      console.error("No matching offer found.");
      return;
    }

    // Update the offer with the answer
    offerToUpdate.answer = answer;

    // Send back existing ICE candidates to the answerer
    if (typeof ackFunction === "function") {
      ackFunction(offerToUpdate.offerIceCandidates);
    } else {
      console.error("No acknowledgment function provided.");
    }

    // Notify the caller about the answer
    socket.to(roomId).emit("call_accepted", {
      answer,
      roomId,
    });
  });

  // Listen for ICE candidates
  socket.on("ice-candidate", (data) => {
    const { roomId, candidate, didIOffer } = data;

    // Find the offer to update
    const offerToUpdate = offers.find((o) => o.roomId === roomId);

    if (!offerToUpdate) {
      console.error("No matching offer found.");
      return;
    }

    // Add ICE candidate to the appropriate list
    if (didIOffer) {
      offerToUpdate.offerIceCandidates.push(candidate);
    } else {
      offerToUpdate.answererIceCandidates.push(candidate);
    }

    // Determine who to send the ICE candidate to
    const targetSocketId = didIOffer
      ? connectedSockets.find((s) => s.roomId === roomId && s.socketId !== socket.id)?.socketId
      : connectedSockets.find((s) => s.roomId === roomId && s.socketId !== socket.id)?.socketId;

    if (targetSocketId) {
      io.to(targetSocketId).emit("ice-candidate", { candidate });
    }
  });

  // Listen for hangup
  socket.on("hangup", (data) => {
    const { roomId } = data;
    console.log(`User in room ${roomId} hung up`);

    // Clean up offers for this room
    const offerIndex = offers.findIndex((o) => o.roomId === roomId);
    if (offerIndex !== -1) {
      offers.splice(offerIndex, 1);
    }

    socket.to(roomId).emit("hangup");
  });

  // Listen for disconnect
  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);

    // Remove user from connectedSockets
    const socketIndex = connectedSockets.findIndex((s) => s.socketId === socket.id);
    const roomId = connectedSockets[socketIndex]?.roomId;
    if (socketIndex !== -1) {
      
      connectedSockets.splice(socketIndex, 1);
    }

    
  
    const offerIndex = offers.findIndex((o) => o.roomId === roomId);
    if (offerIndex !== -1) {
      offers.splice(offerIndex, 1);
    }
    
  });

  // Handle leave_room event
  socket.on("leave_room", (data) => {
    const { roomId } = data;
    console.log(`User ${socket.id} left room: ${roomId}`);

    // Remove user from connectedSockets
    const socketIndex = connectedSockets.findIndex((s) => s.socketId === socket.id);
    if (socketIndex !== -1) {
      connectedSockets.splice(socketIndex, 1);
    }

    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room || room.size === 0) {
      // If no one is left, remove the offer
      const offerIndex = offers.findIndex((o) => o.roomId === roomId);
      if (offerIndex !== -1) {
        offers.splice(offerIndex, 1);
      }
    }

    socket.leave(roomId);
    socket.to(roomId).emit("user_left", { socketId: socket.id });
  });


  // Handle reject_call event
  socket.on("reject_call", (data) => {
    const { roomId } = data;
    console.log(`Call rejected in room: ${roomId}`);

    // Clean up offers for this room
    const offerIndex = offers.findIndex((o) => o.roomId === roomId);
    if (offerIndex !== -1) {
      offers.splice(offerIndex, 1);
    }

    socket.to(roomId).emit("call_rejected");
  });
});
const io = require("socket.io")(5000, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // User joins a room with their name
  socket.on("join_room", (data) => {
    const { roomId, userName } = data;
    const room = io.sockets.adapter.rooms.get(roomId);

    // Ensure only 2 users per room
    if (room && room.size >= 2) {
      socket.emit("room_full", { roomId });
      return;
    }

    socket.join(roomId);
    console.log(`User ${userName} (ID: ${socket.id}) joined room: ${roomId}`);

    // Notify other users in the room about the new user
    socket.to(roomId).emit("user_joined", { userName });
  });

  // User leaves a room
  socket.on("leave_room", (data) => {
    const { roomId } = data;
    socket.leave(roomId);
    console.log(`User (ID: ${socket.id}) left room: ${roomId}`);
    socket.to(roomId).emit("user_left", { userId: socket.id });
  });

  // User starts a call
  socket.on("start_call", (data) => {
    const { roomId, offer, callerName } = data;
    console.log(`Call initiated by ${callerName} in room ${roomId}`);
    socket.to(roomId).emit("incoming_call", { callerName, offer });
  });

  // User accepts a call
  socket.on("accept_call", (data) => {
    const { roomId, answer } = data;
    console.log(`Call accepted in room: ${roomId}`);
    socket.to(roomId).emit("call_accepted", { answer });
  });

  // ICE candidate exchange
  socket.on("ice_candidate", (data) => {
    const { roomId, candidate } = data;
    console.log(`Relaying ICE candidate in room: ${roomId}`);
    socket.to(roomId).emit("ice_candidate", { candidate });
  });

  // User hangs up
  socket.on("hangup", (data) => {
    const { roomId } = data;
    console.log(`User in room ${roomId} hung up`);
    socket.to(roomId).emit("hangup");
  });

  // User rejects a call
  socket.on("reject_call", (data) => {
    const { roomId } = data;
    console.log(`Call rejected in room: ${roomId}`);
    socket.to(roomId).emit("call_rejected");
  });

  // User cancels a call
  socket.on("cancel_call", (data) => {
    const { roomId } = data;
    console.log(`Call cancelled in room: ${roomId}`);
    socket.to(roomId).emit("call_cancelled");
  });

  // User disconnects
  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    // Notify all rooms the user was in
    socket.rooms.forEach((roomId) => {
      if (roomId !== socket.id) {
        socket.to(roomId).emit("user_left", { userId: socket.id });
      }
    });
  });
});
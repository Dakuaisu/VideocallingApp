"use client";
import { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";

const VideoCall = () => {
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isRinging, setIsRinging] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [participants, setParticipants] = useState(new Map()); // Track participants and their streams

  const localStreamRef = useRef(null);
  const remoteStreamsRef = useRef(new Map()); // Store remote streams for each peer
  const peerConnectionsRef = useRef(new Map()); // Store RTCPeerConnection instances
  const socketRef = useRef(null);
  const callTimerRef = useRef(null);

  const configuration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Initialize socket connection
      socketRef.current = io("http://localhost:5000");

      // Listen for incoming calls
      socketRef.current.on("incoming_call", (data) => {
        const { offer, callerId } = data;
        setIncomingCall({ offer, callerId });
      });

      // Listen for call acceptance
      socketRef.current.on("call_accepted", async (data) => {
        const { answer, calleeId } = data;

        const peerConnection = peerConnectionsRef.current.get(calleeId);
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      // Listen for ICE candidates
      socketRef.current.on("ice-candidate", (data) => {
        const { candidate, senderId } = data;
        const peerConnection = peerConnectionsRef.current.get(senderId);
        if (peerConnection) {
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      // Listen for user joining
      socketRef.current.on("user_joined", (data) => {
        const { socketId } = data;
        setParticipants((prev) => new Map(prev.set(socketId, { socketId })));
      });

      // Listen for user leaving
      socketRef.current.on("user_left", (data) => {
        const { socketId } = data;
        setParticipants((prev) => {
          const newMap = new Map(prev);
          newMap.delete(socketId);
          return newMap;
        });
      });

      // Cleanup on unmount
      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
        peerConnectionsRef.current.forEach((pc) => pc.close());
        if (callTimerRef.current) {
          clearInterval(callTimerRef.current);
        }
      };
    }
  }, []);

  const joinRoom = async () => {
    if (!roomId) return;
    socketRef.current.emit("join_room", { roomId: roomId.toLowerCase() });
    setJoined(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localStreamRef.current.srcObject = stream;
  };

  const startCall = async () => {
    const offer = await createOffer();
    socketRef.current.emit("start_call", { roomId, offer });
    setIsRinging(true);
    setInCall(true);
  };

  const createOffer = async () => {
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionsRef.current.set(socketRef.current.id, peerConnection);

    // Add local tracks
    localStreamRef.current.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStreamRef.current);
    });

    // Handle remote tracks
    peerConnection.ontrack = (event) => {
      const remoteStream = new MediaStream();
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      remoteStreamsRef.current.set(socketRef.current.id, remoteStream);
      setParticipants((prev) => new Map(prev.set(socketRef.current.id, { socketId: socketRef.current.id, stream: remoteStream })));
    };

    // Create and return offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    return offer;
  };

  const acceptCall = async () => {
    const { offer, callerId } = incomingCall;

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionsRef.current.set(callerId, peerConnection);

    // Add local tracks
    localStreamRef.current.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStreamRef.current);
    });

    // Handle remote tracks
    peerConnection.ontrack = (event) => {
      const remoteStream = new MediaStream();
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      remoteStreamsRef.current.set(callerId, remoteStream);
      setParticipants((prev) => new Map(prev.set(callerId, { socketId: callerId, stream: remoteStream })));
    };

    // Set remote description and create answer
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send answer to the caller
    socketRef.current.emit("accept_call", { roomId, answer, callerId });
    setIncomingCall(null);
    setInCall(true);
  };

  const handleHangup = () => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    setParticipants(new Map());

    if (localStreamRef.current?.srcObject) {
      localStreamRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localStreamRef.current.srcObject = null;
    }

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }

    setIsRinging(false);
    setInCall(false);
    setIncomingCall(null);
    setCallDuration(0);

    socketRef.current.emit("hangup", { roomId });
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current.srcObject.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOn(videoTrack.enabled);
    }
  };

  const toggleAudio = () => {
    const audioTrack = localStreamRef.current.srcObject.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioOn(audioTrack.enabled);
    }
  };

  const shareScreen = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track.kind === "video");
        sender.replaceTrack(screenTrack);
      });
    } catch (error) {
      console.error("Error sharing screen:", error);
    }
  };

  const formatCallDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex flex-col items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-2xl p-6 w-full max-w-4xl">
        <h2 className="text-3xl font-bold text-white mb-6 text-center">WebRTC Video Call</h2>

        {/* Room ID Input */}
        {!joined && (
          <div className="flex flex-col space-y-4 items-center">
            <input
              className="border border-white/30 bg-white/10 text-white placeholder-white/50 rounded-lg p-3 w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-white"
              type="text"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button
              className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg transition-all duration-300"
              onClick={joinRoom}
            >
              Join Room
            </button>
          </div>
        )}

        {/* Video Grid */}
        {joined && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="relative">
              <video
                ref={localStreamRef}
                autoPlay
                muted
                className="w-full h-auto rounded-lg border-2 border-white/20"
              />
              <span className="absolute bottom-2 left-2 bg-black/50 text-white text-sm px-2 py-1 rounded">
                You
              </span>
            </div>
            {[...participants.values()].map((participant) => (
              <div key={participant.socketId} className="relative">
                <video
                  srcObject={participant.stream}
                  autoPlay
                  className="w-full h-auto rounded-lg border-2 border-white/20"
                />
                <span className="absolute bottom-2 left-2 bg-black/50 text-white text-sm px-2 py-1 rounded">
                  {participant.socketId}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Call Controls */}
        {inCall && (
          <div className="flex justify-center space-x-4 mt-6">
            <button
              className={`${
                isVideoOn ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-500 hover:bg-gray-600"
              } text-white px-6 py-2 rounded-lg transition-all duration-300`}
              onClick={toggleVideo}
            >
              {isVideoOn ? "Video Off" : "Video On"}
            </button>
            <button
              className={`${
                isAudioOn ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-500 hover:bg-gray-600"
              } text-white px-6 py-2 rounded-lg transition-all duration-300`}
              onClick={toggleAudio}
            >
              {isAudioOn ? "Mute" : "Unmute"}
            </button>
            <button
              className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg transition-all duration-300"
              onClick={handleHangup}
            >
              Hang Up
            </button>
            <button
              className="bg-purple-500 hover:bg-purple-600 text-white px-6 py-2 rounded-lg transition-all duration-300"
              onClick={shareScreen}
            >
              Share Screen
            </button>
          </div>
        )}

        {/* Call Duration */}
        {inCall && (
          <p className="text-white text-center mt-4">
            Call Duration: {formatCallDuration(callDuration)}
          </p>
        )}

        {/* Incoming Call Dialog */}
        {incomingCall && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/75">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 text-center">
              <h3 className="text-2xl font-bold text-white">Incoming Call</h3>
              <div className="flex justify-center space-x-4 mt-6">
                <button
                  className="bg-green-500 hover:bg-green-600 text-white px-8 py-2 rounded-lg transition-all duration-300"
                  onClick={acceptCall}
                >
                  Accept
                </button>
                <button
                  className="bg-red-500 hover:bg-red-600 text-white px-8 py-2 rounded-lg transition-all duration-300"
                  onClick={handleCallRejected}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Ringing Dialog */}
        {isRinging && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/75">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 text-center">
              <h3 className="text-2xl font-bold text-white">Calling...</h3>
              <p className="text-white/80 mt-2">Waiting for the other user to accept.</p>
              <button
                className="bg-red-500 hover:bg-red-600 text-white px-8 py-2 rounded-lg mt-6 transition-all duration-300"
                onClick={handleCallRejected}
              >
                Cancel Call
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCall;
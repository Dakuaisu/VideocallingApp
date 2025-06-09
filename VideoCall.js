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
  const roomIdRef = useRef(roomId);

  
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnection = useRef(null);
  const socketRef = useRef(null);
  const callTimerRef = useRef(null);
  const iceCandidateQueue = useRef([]);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);

  const configuration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  useEffect(() => {
    if (remoteStreamRef.current) {
      remoteStreamRef.current.srcObject = new MediaStream();
    }
  }, []);
  
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Initialize socket connection
      socketRef.current = io("http://localhost:5000");

      // Initialize remote stream
      if(!remoteStreamRef){
        remoteStreamRef.current = new MediaStream();
        console.log("Remote stream initialized.");
      }
      // Initialize peer connection
      initializePeerConnection();

      // Listen for incoming calls
      socketRef.current.on("incoming_call", (data) => {
        console.log("Incoming call received:", data);
        setIncomingCall({ offer: data.offer });
      });

      // Listen for call acceptance
      socketRef.current.on("call_accepted", async (data) => {
        console.log("Call accepted, setting remote description:", data);
        if (!data.answer) {
          console.error("No answer received.");
          return;
        }

        try {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log("Remote description set successfully.");
          setIsRinging(false);
          setInCall(true);
          startCallTimer();
          processIceCandidateQueue();
        } catch (error) {
          console.error("Error setting remote description:", error);
        }
      });

      // Listen for ICE candidates
      socketRef.current.on("ice-candidate", async (data) => {
        console.log("Received ICE candidate:", data.candidate);
        const candidate = new RTCIceCandidate(data.candidate);
        if (!peerConnection.current.remoteDescription) {
          console.log("Queuing ICE candidate (remote description not set).");
          iceCandidateQueue.current.push(candidate);
        } else {
          try {
            console.log("Adding ICE candidate.");
            await peerConnection.current.addIceCandidate(candidate);
          } catch (error) {
            console.error("Error adding ICE candidate:", error);
          }
        }
      });

      // Listen for hangup
      socketRef.current.on("hangup", () => {
        console.log("Received hangup event.");
        handleHangup();
      });

      // Cleanup on unmount
      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
        if (peerConnection.current) {
          peerConnection.current.close();
        }
        if (callTimerRef.current) {
          clearInterval(callTimerRef.current);
        }
      };
    }
  }, []);

  const initializePeerConnection = () => {
    console.log("Initializing new peer connection.");
    peerConnection.current = new RTCPeerConnection(configuration);

    // Handle ICE candidates
    peerConnection.current.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate:", event.candidate);
        console.log("Room ID:", roomIdRef.current);
        socketRef.current.emit("ice-candidate", {
          roomId: roomIdRef.current,
          candidate: event.candidate,
          didIOffer: true, // true for the caller, false for the callee
        });
      }
    });

    // Handle remote tracks
    peerConnection.current.addEventListener("track", (event) => {
      console.log("Received remote track:", event.track);
    
      if (!remoteStreamRef.current.srcObject) {
        remoteStreamRef.current.srcObject = new MediaStream();
      }
    
      event.streams[0].getTracks().forEach((track) => {
        remoteStreamRef.current.srcObject.addTrack(track);
      });
    
      console.log("Remote stream tracks:", remoteStreamRef.current.srcObject.getTracks());
    });
  };

  const processIceCandidateQueue = async () => {
    console.log("Processing ICE candidate queue.");
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift();
      try {
        await peerConnection.current.addIceCandidate(candidate);
        console.log("Queued ICE candidate added successfully.");
      } catch (error) {
        console.error("Error adding queued ICE candidate:", error);
      }
    }
  };

  const joinRoom = async () => {
    if (!roomId) {
      alert("Please enter a room ID.");
      return;
    }
    socketRef.current.emit("join_room", { roomId: roomId.toLowerCase() });
    setJoined(true);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      console.error("getUserMedia is not supported on this browser or environment.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current.srcObject = stream;

      stream.getTracks().forEach((track) => {
        console.log("Adding local track to peer connection.");
        peerConnection.current.addTrack(track, stream);
      });
    } catch (error) {
      console.error("Error accessing media devices:", error);
    }
  };

  const startCall = async () => {
    if (!peerConnection.current) {
      console.error("Peer connection is not initialized.");
      return;
    }
    if(!localStreamRef.current.srcObject) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current.srcObject = stream;

      stream.getTracks().forEach((track) => {
        console.log("Adding local track to peer connection.");
        peerConnection.current.addTrack(track, stream);
      });
    }
    console.log("Creating offer.");
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    console.log("Sending offer:", offer);
    socketRef.current.emit("start_call", { roomId, offer });

    setIsRinging(true);
    setInCall(true);

  };

  const handleCallRejected = () => {
    console.log("Call rejected.");
    setIsRinging(false);
    setInCall(false);
    setIncomingCall(null);
    
  
    socketRef.current.emit("reject_call", { roomId });
  };

  const acceptCall = async () => {
    console.log("Accepting call.");
    if (!incomingCall) {
      console.error("No incoming call to accept.");
      return;
    }

    try {
      if(!localStreamRef.current.srcObject) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStreamRef.current.srcObject = stream;
  
        stream.getTracks().forEach((track) => {
          console.log("Adding local track to peer connection.");
          peerConnection.current.addTrack(track, stream);
        });
      }
      console.log("Setting remote description:", incomingCall.offer);
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(incomingCall.offer)
      );
      
      console.log("Creating answer.");
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      console.log("Sending answer:", answer);
      socketRef.current.emit("accept_call", { roomId, answer }, (iceCandidates) => {
        console.log("Received ICE candidates from server:", iceCandidates);
        iceCandidates.forEach((candidate) => {
          peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        });
      });

      peerConnection.current.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
          console.log("Sending ICE candidate:", event.candidate);
          socketRef.current.emit("ice-candidate", {
            roomId: roomIdRef.current,
            candidate: event.candidate,
            didIOffer: false, // false for the callee
          });
        }
      });

      setIsRinging(false);
      setIncomingCall(null);
      setInCall(true);
      startCallTimer();
      processIceCandidateQueue();

    } catch (error) {
      console.error("Error accepting call:", error);
    }
  };

  const handleHangup = () => {
    console.log("Handling hangup.");
    if (peerConnection.current) {
      peerConnection.current.close();
      initializePeerConnection();
    }
    if (localStreamRef.current && localStreamRef.current.srcObject) {
      localStreamRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localStreamRef.current.srcObject = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.srcObject = null;
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

  const leaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.emit("leave_room", { roomId });
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      initializePeerConnection();
    }
    if (localStreamRef.current && localStreamRef.current.srcObject) {
      localStreamRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localStreamRef.current.srcObject = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.srcObject = null;
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }
    setJoined(false);
    setInCall(false);
    setCallDuration(0);
  };

  const startCallTimer = () => {
    callTimerRef.current = setInterval(() => {
      setCallDuration((prevDuration) => prevDuration + 1);
    }, 1000);
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
      const sender = peerConnection.current.getSenders().find((s) => s.track.kind === "video");
      sender.replaceTrack(screenTrack);
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
      {/* Start call and Leave Call buttons */}
      {joined && (
        <div className="flex justify-between gap-4">
          {!inCall && (
            <button
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-all duration-300"
              onClick={startCall}
            >
              Start Call
            </button>
          )}
          <button
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-all duration-300"
            onClick={leaveRoom}
          >
            Leave Room
          </button>
        </div>
      )}

      {/* Video Container */}
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
          <div className="relative">
            <video
              ref={remoteStreamRef}
              autoPlay
              className="w-full h-auto rounded-lg border-2 border-white/20"
            />
            <span className="absolute bottom-2 left-2 bg-black/50 text-white text-sm px-2 py-1 rounded">
              Partner
            </span>
          </div>
        </div>
      )}

      {/* Call Controls */}
      {inCall && !isRinging && (
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
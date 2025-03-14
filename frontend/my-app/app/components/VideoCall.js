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

  const formatCallDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      <h2 className="text-xl font-bold">WebRTC Video Call</h2>

      {/* Room ID Input */}
      {!joined && (
        <input
          className="border p-2 rounded"
          type="text"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
      )}

      {/* Join Room Button */}
      {!joined && (
        <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={joinRoom}>
          Join Room
        </button>
      )}

      {/* Leave Room Button */}
      {joined && (
        <button className="bg-red-500 text-white px-4 py-2 rounded" onClick={leaveRoom}>
          Leave Room
        </button>
      )}

      {/* In Room Status */}
      {joined && <p className="text-gray-600">In Room: {joined ? "Yes" : "No"}</p>}

      {/* Start Call Button (visible after joining) */}
      {joined && !inCall && (
        <button className="bg-green-500 text-white px-4 py-2 rounded" onClick={startCall}>
          Start Call
        </button>
      )}

      {/* Calling Menu (visible when ringing) */}
      {isRinging && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-bold">Calling...</h3>
            <p className="text-gray-600">Waiting for the other user to accept.</p>
            <button
              className="bg-red-500 text-white px-4 py-2 rounded mt-4"
              onClick={handleCallRejected}
            >
              Cancel Call
            </button>
          </div>
        </div>
      )}

      {/* Incoming Call Dialog */}
      {incomingCall && (
        <div className=" inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-bold">Incoming Call</h3>
            <div className="flex space-x-4 mt-4">
              <button
                className="bg-green-500 text-white px-8 py-2 rounded"
                onClick={acceptCall}
              >
                Accept
              </button>
              <button
                className="bg-red-500 text-white px-4 py-2 rounded"
                onClick={handleCallRejected}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call Interface (visible during a call) */}
      {inCall && !isRinging && (
        <div className="flex flex-col items-center space-y-4">
          <h3 className="text-lg font-bold">In Call</h3>
          <p className="text-gray-600">Call Duration: {formatCallDuration(callDuration)}</p>
          <button className="bg-red-500 text-white px-4 py-2 rounded" onClick={handleHangup}>
            Hang Up
          </button>
        </div>
      )}

      {/* Video Elements */}
      <video ref={localStreamRef} autoPlay muted className="w-64 h-48 border-2 border-gray-400" />
      <video ref={remoteStreamRef} autoPlay className="w-64 h-48 border-2 border-gray-400" />
    </div>
  );
};

export default VideoCall;
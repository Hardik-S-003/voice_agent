(function () {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pingBtn = document.getElementById("pingBtn");

  const connDot = document.getElementById("connDot");
  const connText = document.getElementById("connText");
  const sessionText = document.getElementById("sessionText");
  const bytesText = document.getElementById("bytesText");
  const fileText = document.getElementById("fileText");
  const transcriptText = document.getElementById("transcriptText");

  let ws = null;
  let mediaRecorder = null;
  let totalBytesSent = 0;
  let currentSession = null;

  function setConn(state, error = false) {
    connText.textContent = state;
    connDot.classList.remove("ok", "err");
    if (state === "connected") connDot.classList.add("ok");
    if (error) connDot.classList.add("err");
  }

  function wsUrlFromLocation() {
    const proto = (location.protocol === "https:") ? "wss" : "ws";
    return `${proto}://${location.host}/ws`;
  }

  async function initRecorder() {
    try {
      console.log("Requesting audio permissions...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      console.log("Audio stream obtained:", stream.getAudioTracks()[0].getSettings());

      // Check if WebM with Opus is supported
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        throw new Error('Browser does not support WebM with Opus');
      }

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      });

      console.log("MediaRecorder initialized with settings:", {
        mimeType: mediaRecorder.mimeType,
        state: mediaRecorder.state,
        audioBitsPerSecond: mediaRecorder.audioBitsPerSecond
      });

      mediaRecorder.ondataavailable = async (e) => {
        if (!e.data || e.data.size === 0) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.warn("WebSocket not ready, data dropped");
          return;
        }

        try {
          const buf = await e.data.arrayBuffer();
          ws.send(buf);
          totalBytesSent += buf.byteLength;
          bytesText.textContent = String(totalBytesSent);
        } catch (err) {
          console.error("WS send error:", err);
          setConn("error", true);
          transcriptText.textContent = "Error sending audio: " + err.message;
        }
      };

      mediaRecorder.onstart = () => {
        console.log("MediaRecorder started");
        transcriptText.textContent = "Listening...";
      };

      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped");
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stop" }));
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event.error);
        transcriptText.textContent = "Recording error: " + event.error.message;
      };

      return true;
    } catch (error) {
      console.error("Audio initialization error:", error);
      transcriptText.textContent = "Audio Error: " + error.message;
      return false;
    }
  }

  async function startRecording() {
    try {
      totalBytesSent = 0;
      bytesText.textContent = "0";
      fileText.textContent = "–";
      transcriptText.textContent = "Initializing...";
      currentSession = `sess_${Date.now()}`;
      sessionText.textContent = currentSession;

      console.log("Opening WebSocket connection...");
      ws = new WebSocket(wsUrlFromLocation());

      ws.onopen = async () => {
        console.log("WebSocket connected");
        setConn("connected");
        
        if (!mediaRecorder) {
          console.log("Initializing audio recorder...");
          const initialized = await initRecorder();
          if (!initialized) {
            console.error("Failed to initialize audio recorder");
            ws.close();
            return;
          }
        }

        ws.send(JSON.stringify({ 
          type: "start", 
          session: currentSession
        }));

        mediaRecorder.start(500);
        startBtn.disabled = true;
        stopBtn.disabled = false;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          console.log("Received message:", msg);
          
          if (msg.type === "ack") {
            console.log("Recording acknowledged:", msg);
          } else if (msg.type === "saved") {
            console.log("Recording saved:", msg);
            fileText.innerHTML = msg.url
              ? `<a class="link" href="${msg.url}" target="_blank">${msg.file}</a>`
              : (msg.file || "–");
          } else if (msg.type === "error") {
            console.error("Server error:", msg.message);
            setConn("error", true);
            transcriptText.textContent = "Server Error: " + msg.message;
          } else if (msg.type === "transcript") {
            console.log("Transcript received:", msg);
            transcriptText.textContent = msg.text || "No transcription available";
          }
        } catch (error) {
          console.error("Message parsing error:", error);
          transcriptText.textContent = "Message Error: " + error.message;
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setConn("error", true);
        transcriptText.textContent = "Connection error: " + (err.message || "Unknown error");
      };

      ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        setConn("disconnected");
        startBtn.disabled = false;
        stopBtn.disabled = true;
        if (event.code !== 1000) {
          transcriptText.textContent = `Connection closed (${event.code}): ${event.reason || "No reason provided"}`;
        }
      };
    } catch (error) {
      console.error("Start recording error:", error);
      transcriptText.textContent = "Start Error: " + error.message;
      setConn("error", true);
    }
  }

  function stopRecording() {
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        console.log("Stopping MediaRecorder...");
        mediaRecorder.stop();
      }
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("Sending stop signal...");
        ws.send(JSON.stringify({ type: "stop" }));
        setTimeout(() => ws.close(), 500);
      }
    } catch (error) {
      console.error("Stop recording error:", error);
      transcriptText.textContent = "Stop Error: " + error.message;
    }
  }

  // Buttons
  startBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", stopRecording);
  pingBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    } else {
      console.warn("Cannot ping: WebSocket not connected");
    }
  });

  // Initial states
  setConn("disconnected");
  sessionText.textContent = "–";
  bytesText.textContent = "0";
  fileText.textContent = "–";
  transcriptText.textContent = "Ready";

  // Check browser compatibility
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    transcriptText.textContent = "Error: Browser doesn't support audio recording";
    startBtn.disabled = true;
  }
})();
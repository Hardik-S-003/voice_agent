(function () {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pingBtn = document.getElementById("pingBtn");

  const connDot = document.getElementById("connDot");
  const connText = document.getElementById("connText");
  const sessionText = document.getElementById("sessionText");
  const bytesText = document.getElementById("bytesText");
  const fileText = document.getElementById("fileText");

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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 48000,       // browser controls this, but hinting is fine
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 128000
    });

    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      try {
        const buf = await e.data.arrayBuffer();
        ws.send(buf);
        totalBytesSent += buf.byteLength;
        bytesText.textContent = String(totalBytesSent);
      } catch (err) {
        console.error("WS send error:", err);
        setConn("error", true);
      }
    };

    mediaRecorder.onstart = () => {
      console.log("MediaRecorder started");
    };

    mediaRecorder.onstop = () => {
      console.log("MediaRecorder stopped");
      // Tell server we’re done so it can close the file and reply with the saved URL
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stop" }));
        // give the server a moment to respond before closing
        setTimeout(() => {
          try { ws.close(); } catch (_) {}
        }, 300);
      }
    };
  }

  async function startRecording() {
    // (Re)initialize values
    totalBytesSent = 0;
    bytesText.textContent = "0";
    fileText.textContent = "–";
    currentSession = `sess_${Date.now()}`;
    sessionText.textContent = currentSession;

    // Open WebSocket
    ws = new WebSocket(wsUrlFromLocation());

    ws.onopen = async () => {
      setConn("connected");
      // Send control message to open a file on server
      ws.send(JSON.stringify({ type: "start", session: currentSession }));
      // Start capturing audio
      if (!mediaRecorder) await initRecorder();
      mediaRecorder.start(500); // emit chunks every 500ms
      startBtn.disabled = true;
      stopBtn.disabled = false;
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "ack") {
          console.log("server ack:", msg);
        } else if (msg.type === "saved") {
          console.log("saved:", msg);
          fileText.innerHTML = msg.url
            ? `<a class="link" href="${msg.url}" target="_blank">${msg.file}</a>`
            : (msg.file || "–");
        } else if (msg.type === "error") {
          console.error("server error:", msg.message);
          setConn("error", true);
        } else if (msg.type === "pong") {
          console.log("pong", msg.t);
        }
      } catch {
        // Non-JSON server messages (shouldn't happen in this flow)
        console.log("server:", evt.data);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setConn("error", true);
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      setConn("disconnected");
      startBtn.disabled = false;
      stopBtn.disabled = true;
    };
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      // If no active recorder, still try to signal stop and close ws
      try { ws?.send(JSON.stringify({ type: "stop" })); } catch (_) {}
      try { ws?.close(); } catch (_) {}
    }
  }

  // Buttons
  startBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", stopRecording);
  pingBtn.addEventListener("click", () => {
    try {
      ws?.send(JSON.stringify({ type: "ping" }));
    } catch (e) {
      console.warn("cannot ping:", e);
    }
  });

  // Initial states
  setConn("disconnected");
  sessionText.textContent = "–";
  bytesText.textContent = "0";
  fileText.textContent = "–";
})();

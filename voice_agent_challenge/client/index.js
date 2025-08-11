document.addEventListener('DOMContentLoaded', () => {
  const speakButton = document.getElementById('speakButton');
  const textInput = document.getElementById('textInput');
  const statusMessage = document.getElementById('uploadStatus');

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;
  let autoStartNext = false;

  const startButton = document.getElementById("startRecord");
  const stopButton = document.getElementById("stopRecord");
  const resetButton = document.getElementById("resetRecord");
  const audioPlayback = document.getElementById("audioPlayback");
  const transcriptionOutput = document.getElementById("transcription");

  const sessionIdEl = document.getElementById('sessionId');
  const newSessionBtn = document.getElementById('newSession');

  const params = new URLSearchParams(window.location.search);
  let sessionId = params.get('session');
  const genSessionId = () => `sess_${Date.now()}_${Math.floor(Math.random()*9000+1000)}`;

  if (!sessionId) {
    sessionId = genSessionId();
    params.set('session', sessionId);
    const newUrl = `${location.pathname}?${params.toString()}`;
    history.replaceState({}, '', newUrl);
  }
  sessionIdEl.textContent = sessionId;

  newSessionBtn.addEventListener('click', () => {
    sessionId = genSessionId();
    params.set('session', sessionId);
    const newUrl = `${location.pathname}?${params.toString()}`;
    history.replaceState({}, '', newUrl);
    sessionIdEl.textContent = sessionId;
    statusMessage.textContent = 'New session created';
  });

  speakButton.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
      alert("Please enter some text.");
      return;
    }

    try {
      statusMessage.textContent = "Generating speech...";
      speakButton.disabled = true;

      const response = await fetch('/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const data = await response.json();
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.onended = () => {
          statusMessage.textContent = "Playback complete!";
          speakButton.disabled = false;
        };
        audio.onerror = () => {
          statusMessage.textContent = "Error playing audio.";
          speakButton.disabled = false;
        };
        audio.play();
      } else {
        throw new Error(data.error || "Audio generation failed.");
      }
    } catch (error) {
      console.error("Error:", error);
      statusMessage.textContent = "Error: " + error.message;
      speakButton.disabled = false;
    }
  });

  const initializeMediaRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 44100,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true
        }
      });

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstart = () => {
        console.log('Recording started');
        isRecording = true;
        audioChunks = [];
        statusMessage.textContent = "Recording...";
      };

      mediaRecorder.onstop = async () => {
        console.log('Recording stopped');
        isRecording = false;

        if (audioChunks.length === 0) {
          statusMessage.textContent = "No audio recorded";
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        console.log('Audio size:', audioBlob.size, 'bytes');

        if (audioBlob.size < 1000) {
          statusMessage.textContent = "Recording too short or empty";
          return;
        }

        const localUrl = URL.createObjectURL(audioBlob);
        audioPlayback.src = localUrl;

        resetButton.disabled = false;
        statusMessage.textContent = "Processing audio...";
        transcriptionOutput.textContent = "";

        const formData = new FormData();
        const fileName = `recording_${Date.now()}.webm`;
        formData.append('audio', audioBlob, fileName);

        try {
          const response = await fetch(`/agent/chat/${encodeURIComponent(sessionId)}`, {
            method: 'POST',
            body: formData
          });

          const data = await response.json();

          if (data.error) {
            throw new Error(data.error);
          }

          if (data.audioUrl) {
            audioPlayback.src = data.audioUrl;
            audioPlayback.onended = () => {
              statusMessage.textContent = "Assistant finished playing.";

              if (data.transcript) {
                transcriptionOutput.textContent = `You: ${data.transcript}`;
              }
              if (data.llm_text) {
                const assistantLine = document.createElement('div');
                assistantLine.textContent = `Assistant: ${data.llm_text}`;
                assistantLine.style.marginTop = "6px";
                assistantLine.style.color = "#aaffee";
                transcriptionOutput.appendChild(assistantLine);
              }

              setTimeout(() => {
                try {
                  if (!mediaRecorder) {
                    initializeMediaRecorder().then((ok) => {
                      if (ok) startRecording();
                    });
                  } else {
                    startRecording();
                  }
                } catch (err) {
                  console.error("Auto start error:", err);
                }
              }, 500);
            };

            await audioPlayback.play();
            statusMessage.textContent = "Playing assistant response...";
          } else {
            throw new Error("No audio URL received from server");
          }
        } catch (err) {
          console.error("Processing error:", err);
          statusMessage.textContent = `Error: ${err.message}`;
        }
      };

      return true;
    } catch (err) {
      console.error("Mic access error:", err);
      statusMessage.textContent = "Error: Microphone access denied";
      return false;
    }
  };
  const startRecording = async () => {
    if (!mediaRecorder) {
      const ok = await initializeMediaRecorder();
      if (!ok) {
        statusMessage.textContent = "Unable to access microphone.";
        return;
      }
    }
    try {
      mediaRecorder.start(1000); 
      startButton.disabled = true;
      stopButton.disabled = false;
      resetButton.disabled = true;
    } catch (err) {
      console.error("Recording error:", err);
      statusMessage.textContent = "Error starting recording";
    }
  };

  startButton.addEventListener("click", async () => {
    await startRecording();
  });

  stopButton.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
        startButton.disabled = false;
        stopButton.disabled = true;
      } catch (err) {
        console.error("Error stopping recording:", err);
        statusMessage.textContent = "Error stopping recording";
      }
    }
  });

  resetButton.addEventListener("click", () => {
    try {
      audioPlayback.pause();
      audioPlayback.src = "";
      audioChunks = [];
      statusMessage.textContent = "";
      transcriptionOutput.textContent = "";
      resetButton.disabled = true;
      startButton.disabled = false;
    } catch (err) {
      console.error("Error resetting:", err);
      statusMessage.textContent = "Error resetting recording";
    }
  });

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    console.log("Media devices supported");
  } else {
    console.error("Media devices not supported");
    statusMessage.textContent = "Error: Your browser doesn't support audio recording";
    startButton.disabled = true;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const speakButton = document.getElementById('speakButton');
  const textInput = document.getElementById('textInput');
  const statusMessage = document.getElementById('uploadStatus');

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;

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

  const FALLBACK_AUDIO = '/uploads/fallback.mp3';

  async function playAudioUrl(url) {
    try {
      if (!url) throw new Error("No audio URL provided");
      const a = new Audio(url);
      await a.play();
      return a;
    } catch (err) {
      console.warn("Failed to play audio URL:", err);
      try {
        const fb = new Audio(FALLBACK_AUDIO);
        await fb.play();
        return fb;
      } catch (err2) {
        console.error("Failed to play fallback audio:", err2);
        return null;
      }
    }
  }

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
        const audio = await playAudioUrl(data.audioUrl);
        if (audio) {
          audio.onended = () => {
            statusMessage.textContent = "Playback complete!";
            speakButton.disabled = false;
          };
        } else {
          statusMessage.textContent = "Playback failed (fallback played or unavailable).";
          speakButton.disabled = false;
        }
      } else {
        throw new Error(data.error || "Audio generation failed.");
      }
    } catch (error) {
      console.error("Error during TTS:", error);
      statusMessage.textContent = "Error: " + (error.message || error);
      await playAudioUrl(FALLBACK_AUDIO);
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
            console.error("Server returned error:", data.error);
            statusMessage.textContent = `Server error: ${data.error}`;
          }

          const audioUrlToPlay = data.audioUrl || FALLBACK_AUDIO;
          const played = await playAudioUrl(audioUrlToPlay);

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

          if (played) {
            played.onended = () => {
              statusMessage.textContent = "Assistant finished playing.";
              setTimeout(async () => {
                try {
                  if (!mediaRecorder) {
                    const ok = await initializeMediaRecorder();
                    if (ok) {
                      startRecording();
                    }
                  } else {
                    startRecording();
                  }
                } catch (err) {
                  console.error("Auto-start recording error:", err);
                }
              }, 500);
            };
            statusMessage.textContent = "Playing assistant response...";
          } else {
            statusMessage.textContent = "Could not play assistant audio (played fallback or none).";
          }
        } catch (err) {
          console.error("Processing error:", err);
          statusMessage.textContent = `Error: ${err.message || err}`;
          await playAudioUrl(FALLBACK_AUDIO);
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

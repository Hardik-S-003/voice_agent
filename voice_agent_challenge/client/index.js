document.addEventListener('DOMContentLoaded', () => {
  const speakButton = document.getElementById('speakButton');
  const textInput = document.getElementById('textInput');

  speakButton.addEventListener('click', async () => {
    const text = textInput.value;
    if (!text) {
      alert("Please enter some text.");
      return;
    }

    try {
      const response = await fetch('/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const data = await response.json();
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.play();
      } else {
        alert("Audio generation failed.");
      }
    } catch (error) {
      console.error("Error:", error);
    }
  });

  let mediaRecorder;
  let audioChunks = [];

  const startButton = document.getElementById("startRecord");
  const stopButton = document.getElementById("stopRecord");
  const resetButton = document.getElementById("resetRecord");
  const audioPlayback = document.getElementById("audioPlayback");
  const statusMessage = document.getElementById("uploadStatus");
  const transcriptionOutput = document.getElementById("transcription");

  startButton.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        resetButton.disabled = false;

        const formData = new FormData();
        const fileName = `recording_${Date.now()}.webm`;
        formData.append('audio', audioBlob, fileName);

        statusMessage.textContent = "Processing via Murf + AssemblyAI...";
        transcriptionOutput.textContent = "";

        fetch('/tts/echo', {
          method: 'POST',
          body: formData
        })
          .then(res => res.json())
          .then(data => {
            if (data.audioUrl) {
              audioPlayback.src = data.audioUrl;
              audioPlayback.play();
              statusMessage.textContent = "Playback complete in Murf voice!";
            } else {
              statusMessage.textContent = "Failed to process audio.";
            }
          })
          .catch(() => {
            statusMessage.textContent = "Error during transcription/echo.";
          });
      };

      mediaRecorder.start();
      startButton.disabled = true;
      stopButton.disabled = false;
      resetButton.disabled = true;
    } catch (err) {
      alert("Microphone access is required.");
    }
  });

  stopButton.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    startButton.disabled = false;
    stopButton.disabled = true;
  });

  resetButton.addEventListener("click", () => {
    audioPlayback.pause();
    audioPlayback.src = "";
    audioChunks = [];
    statusMessage.textContent = "";
    transcriptionOutput.textContent = "";
    resetButton.disabled = true;
  });
});

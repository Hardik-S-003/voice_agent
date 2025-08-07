document.addEventListener('DOMContentLoaded', () => {
  // Text to Speech
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

  // Echo Bot
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
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayback.src = audioUrl;
        resetButton.disabled = false;

        const formData = new FormData();
        const fileName = `recording_${Date.now()}.webm`;
        formData.append('audio', audioBlob, fileName);

        statusMessage.textContent = "Uploading...";
        transcriptionOutput.textContent = "";

        fetch('/upload-audio', {
          method: 'POST',
          body: formData
        })
          .then(res => res.json())
          .then(data => {
            if (data.filename) {
              statusMessage.textContent = `Upload successful: ${data.filename} (${data.size_readable})`;
            } else {
              statusMessage.textContent = "Upload failed.";
            }
          })
          .catch(() => {
            statusMessage.textContent = "Error uploading file.";
          });

        fetch('/transcribe/file', {
          method: 'POST',
          body: formData
        })
          .then(res => res.json())
          .then(data => {
            if (data.transcription) {
              transcriptionOutput.textContent = `Transcript: ${data.transcription}`;
            } else {
              transcriptionOutput.textContent = "Transcription failed.";
            }
          })
          .catch(() => {
            transcriptionOutput.textContent = "Error during transcription.";
          });
      };

      mediaRecorder.start();
      startButton.disabled = true;
      stopButton.disabled = false;
      resetButton.disabled = true;
    } catch (err) {
      alert("Microphone access required.");
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

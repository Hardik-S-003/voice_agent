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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: text })
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
      alert("Something went wrong.");
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  let mediaRecorder;
  let audioChunks = [];

  const startButton = document.getElementById("startRecord");
  const stopButton = document.getElementById("stopRecord");
  const resetButton = document.getElementById("resetRecord");
  const audioPlayback = document.getElementById("audioPlayback");

  startButton.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);

      audioChunks = [];

      mediaRecorder.ondataavailable = event => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayback.src = audioUrl;
        resetButton.disabled = false;
      };

      mediaRecorder.start();

      startButton.disabled = true;
      stopButton.disabled = false;
      resetButton.disabled = true;
    } catch (err) {
      alert("Microphone access is required.");
      console.error(err);
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
    resetButton.disabled = true;
  });
});


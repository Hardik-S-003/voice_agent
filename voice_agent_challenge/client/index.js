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
        // Play the audio if a URL is returned
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

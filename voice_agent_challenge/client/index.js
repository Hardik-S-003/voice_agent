document.addEventListener('DOMContentLoaded', () => {

  const messagesEl = document.getElementById('messages');
  const statusEl = document.getElementById('uploadStatus');
  const micButton = document.getElementById('micButton');
  const sessionIdEl = document.getElementById('sessionId');
  const newSessionBtn = document.getElementById('newSession');
  const audioPlayback = document.getElementById('audioPlayback'); 

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;

  const params = new URLSearchParams(window.location.search);
  const genSessionId = () => `sess_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
  let sessionId = params.get('session') || genSessionId();
  if (!params.get('session')) {
    params.set('session', sessionId);
    history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
  }
  sessionIdEl.textContent = sessionId;

  newSessionBtn.addEventListener('click', () => {
    sessionId = genSessionId();
    params.set('session', sessionId);
    history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
    sessionIdEl.textContent = sessionId;
    statusEl.textContent = 'New session started.';
    appendBot('New session created. Tap the mic to start talking.');
  });

  const FALLBACK_AUDIO = '/uploads/fallback.mp3';

  const scrollToBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  function appendUser(text) {
    const row = document.createElement('div');
    row.className = 'msg user';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function appendBot(text, smallNote) {
    const row = document.createElement('div');
    row.className = 'msg bot';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text || '';
    if (smallNote) {
      const small = document.createElement('span');
      small.className = 'small';
      small.textContent = smallNote;
      bubble.appendChild(small);
    }
    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  async function playAudioUrl(url) {
    try {
      if (!url) throw new Error('No audio URL provided');
      const audio = new Audio(url);
      await audio.play();
      return audio;
    } catch (e) {
      console.warn('Audio play failed, trying fallback:', e);
      try {
        const fb = new Audio(FALLBACK_AUDIO);
        await fb.play();
        return fb;
      } catch (e2) {
        console.error('Fallback audio also failed:', e2);
        return null;
      }
    }
  }

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
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstart = () => {
        isRecording = true;
        audioChunks = [];
        statusEl.textContent = 'Listening…';
        micButton.classList.add('recording');
      };

      mediaRecorder.onstop = async () => {
        isRecording = false;
        micButton.classList.remove('recording');
        statusEl.textContent = 'Processing…';

        if (audioChunks.length === 0) {
          statusEl.textContent = 'No audio recorded.';
          return;
        }

        const blob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        if (blob.size < 1000) {
          statusEl.textContent = 'Recording too short.';
          return;
        }

        const formData = new FormData();
        const fileName = `recording_${Date.now()}.webm`;
        formData.append('audio', blob, fileName);

        try {
          const resp = await fetch(`/agent/chat/${encodeURIComponent(sessionId)}`, {
            method: 'POST',
            body: formData
          });
          const data = await resp.json();

          if (data.error) {
            statusEl.textContent = `Server error: ${data.error}`;
          }

          if (data.transcript) appendUser(data.transcript);
          if (data.llm_text) appendBot(data.llm_text);

          const toPlay = data.audioUrl || FALLBACK_AUDIO;
          const playing = await playAudioUrl(toPlay);

          if (playing) {
            statusEl.textContent = 'Speaking…';
            playing.onended = () => {
              statusEl.textContent = 'Ready.';
              setTimeout(() => { startRecording().catch(()=>{}); }, 450);
            };
          } else {
            statusEl.textContent = 'Could not play audio.';
          }
        } catch (e) {
          console.error('Processing error:', e);
          statusEl.textContent = `Error: ${e.message || e}`;
          appendBot('I had trouble connecting. You can try again.');
          await playAudioUrl(FALLBACK_AUDIO);
        }
      };

      return true;
    } catch (err) {
      console.error('Mic access error:', err);
      statusEl.textContent = 'Microphone access denied.';
      return false;
    }
  };

  async function startRecording() {
    if (!mediaRecorder) {
      const ok = await initializeMediaRecorder();
      if (!ok) return;
    }
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
      try {
        mediaRecorder.start(1000);
      } catch (e) {
        console.error('Start recording failed:', e);
        statusEl.textContent = 'Error starting recording.';
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.error('Stop recording failed:', e);
        statusEl.textContent = 'Error stopping recording.';
      }
    }
  }

  micButton.addEventListener('click', async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      await startRecording();
    } else {
      stopRecording();
    }
  });

  statusEl.textContent = 'Ready. Tap the mic and speak.';
});

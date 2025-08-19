document.addEventListener('DOMContentLoaded', () => {

  const messagesEl = document.getElementById('messages');
  const statusEl = document.getElementById('uploadStatus');
  const micButton = document.getElementById('micButton');
  const sessionIdEl = document.getElementById('sessionId');
  const newSessionBtn = document.getElementById('newSession');
  const streamingToggle = document.getElementById('streamingToggle');

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;
  let socket;
  let streamingMode = false;
  let streamingSession = null;

  const params = new URLSearchParams(window.location.search);
  const genSessionId = () => `sess_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
  let sessionId = params.get('session') || genSessionId();
  if (!params.get('session')) {
    params.set('session', sessionId);
    history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
  }
  sessionIdEl.textContent = sessionId;

  const FALLBACK_AUDIO = '/uploads/fallback.mp3';

  // Initialize Socket.IO connection
  const initializeSocket = () => {
    socket = io();
    
    socket.on('connect', () => {
      console.log('WebSocket connected');
      statusEl.textContent = 'Connected to server.';
    });
    
    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      statusEl.textContent = 'Disconnected from server.';
    });
    
    socket.on('connection_established', (data) => {
      console.log('Connection established:', data);
    });
    
    socket.on('echo_message', (data) => {
      console.log('Echo received:', data);
      appendBot(`Echo: ${data.echo}`);
    });
    
    socket.on('streaming_started', (data) => {
      console.log('Streaming started:', data);
      statusEl.textContent = 'Real-time streaming active.';
    });
    
    socket.on('partial_transcript', (data) => {
      updatePartialTranscript(data.text, data.is_final);
    });
    
    socket.on('turn_ended', (data) => {
      console.log('Turn ended:', data);
      handleTurnEnd(data.final_transcript);
    });
    
    socket.on('agent_response', (data) => {
      console.log('Agent response received:', data);
      handleAgentResponse(data);
    });
    
    socket.on('streaming_stopped', (data) => {
      console.log('Streaming stopped:', data);
      statusEl.textContent = 'Streaming stopped.';
      streamingSession = null;
    });
    
    socket.on('error', (data) => {
      console.error('Socket error:', data);
      statusEl.textContent = `Error: ${data.message}`;
    });
  };

  // Initialize socket connection
  initializeSocket();

  newSessionBtn.addEventListener('click', () => {
    sessionId = genSessionId();
    params.set('session', sessionId);
    history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
    sessionIdEl.textContent = sessionId;
    statusEl.textContent = 'New session started.';
    appendBot('New session created. Toggle streaming mode or tap the mic to start talking.');
    
    // Clear messages
    const messages = messagesEl.querySelectorAll('.msg:not(.welcome)');
    messages.forEach(msg => msg.remove());
  });

  const scrollToBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  function appendUser(text, isPartial = false) {
    // Remove existing partial message
    const existingPartial = messagesEl.querySelector('.msg.user.partial');
    if (existingPartial) {
      existingPartial.remove();
    }
    
    const row = document.createElement('div');
    row.className = `msg user${isPartial ? ' partial' : ''}`;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    
    if (isPartial) {
      bubble.style.opacity = '0.7';
      bubble.style.fontStyle = 'italic';
    }
    
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

  function updatePartialTranscript(text, isFinal) {
    if (isFinal) {
      // Remove partial and add final
      const existingPartial = messagesEl.querySelector('.msg.user.partial');
      if (existingPartial) {
        existingPartial.remove();
      }
      // Don't add final here - wait for turn_ended
    } else {
      // Update or create partial transcript
      appendUser(text, true);
    }
  }

  function handleTurnEnd(finalTranscript) {
    // Remove partial transcript and add final
    const existingPartial = messagesEl.querySelector('.msg.user.partial');
    if (existingPartial) {
      existingPartial.remove();
    }
    
    if (finalTranscript.trim()) {
      appendUser(finalTranscript);
      statusEl.textContent = 'Processing response...';
    }
  }

  async function handleAgentResponse(data) {
    const { transcript, llm_text, audioUrl } = data;
    
    // Add bot response to UI
    if (llm_text) {
      appendBot(llm_text);
    }
    
    // Play audio response
    const toPlay = audioUrl || FALLBACK_AUDIO;
    const playing = await playAudioUrl(toPlay);
    
    if (playing) {
      statusEl.textContent = 'Speaking…';
      playing.onended = () => {
        statusEl.textContent = 'Ready for next input.';
        // Reset turn state
        socket.emit('reset_turn', { session_id: sessionId });
        // In streaming mode, automatically restart listening
        if (streamingMode && streamingSession) {
          setTimeout(() => {
            startRecording().catch(() => {});
          }, 500);
        }
      };
    } else {
      statusEl.textContent = 'Could not play audio.';
    }
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

      const mimeType = streamingMode ? 'audio/webm;codecs=opus' : 'audio/webm;codecs=opus';
      
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: 128000
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          if (streamingMode && streamingSession) {
            // Stream audio data in real-time
            streamAudioData(e.data);
          } else {
            // Accumulate for batch processing
            audioChunks.push(e.data);
          }
        }
      };

      mediaRecorder.onstart = () => {
        isRecording = true;
        audioChunks = [];
        statusEl.textContent = streamingMode ? 'Streaming...' : 'Listening…';
        micButton.classList.add('recording');
        
        // Start streaming session if in streaming mode
        if (streamingMode && !streamingSession) {
          startStreamingSession();
        }
      };

      mediaRecorder.onstop = async () => {
        isRecording = false;
        micButton.classList.remove('recording');
        
        if (streamingMode) {
          // In streaming mode, don't process chunks here
          statusEl.textContent = 'Processing...';
          return;
        }
        
        // Legacy batch processing mode
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

  function startStreamingSession() {
    if (!socket || !socket.connected) {
      statusEl.textContent = 'Not connected to server.';
      return;
    }
    
    streamingSession = sessionId;
    socket.emit('start_streaming', { session_id: sessionId });
  }

  function streamAudioData(audioBlob) {
    if (!socket || !streamingSession) return;
    
    // Convert blob to base64 for transmission
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(',')[1]; // Remove data:audio/webm;base64, prefix
      socket.emit('audio_data', {
        session_id: sessionId,
        audio: base64Data
      });
    };
    reader.readAsDataURL(audioBlob);
  }

  async function startRecording() {
    if (!mediaRecorder) {
      const ok = await initializeMediaRecorder();
      if (!ok) return;
    }
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
      try {
        // In streaming mode, use shorter intervals for real-time processing
        const interval = streamingMode ? 500 : 1000;
        mediaRecorder.start(interval);
      } catch (e) {
        console.error('Start recording failed:', e);
        statusEl.textContent = 'Error starting recording.';
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      
      if (streamingMode && streamingSession) {
        socket.emit('stop_streaming', { session_id: sessionId });
      }
    }
  }

  // Add streaming toggle functionality
  if (streamingToggle) {
    streamingToggle.addEventListener('change', (e) => {
      streamingMode = e.target.checked;
      const modeText = streamingMode ? 'Real-time Streaming' : 'Batch Processing';
      statusEl.textContent = `Mode: ${modeText}`;
      
      // Stop current recording if switching modes
      if (isRecording) {
        stopRecording();
      }
      
      // Reset media recorder to reinitialize with new settings
      mediaRecorder = null;
      
      appendBot(`Switched to ${modeText} mode.`, 
        streamingMode ? 'Real-time transcription enabled' : 'Traditional recording mode');
    });
  }

  // Mic button event handler
  micButton.addEventListener('click', async () => {
    if (!isRecording) {
      await startRecording();
    } else {
      stopRecording();
    }
  });

  // Test WebSocket functionality (Day 15)
  window.testWebSocket = () => {
    if (socket && socket.connected) {
      socket.emit('test_message', { 
        message: 'Hello from client!', 
        timestamp: new Date().toISOString() 
      });
    } else {
      console.error('Socket not connected');
    }
  };

  // Add welcome message
  appendBot('Welcome to AI Voice Agent!', 'WebSocket enabled for real-time streaming');
  
  // Initialize in batch mode by default
  statusEl.textContent = 'Ready. Toggle streaming mode or tap mic to begin.';
});
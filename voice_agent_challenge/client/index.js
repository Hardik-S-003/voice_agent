document.addEventListener('DOMContentLoaded', function() {
    const micButton = document.getElementById('micButton');
    const statusText = document.getElementById('statusText');
    const messagesContainer = document.getElementById('messages');
    const sessionIdElement = document.getElementById('sessionId');
    const newSessionButton = document.getElementById('newSession');
    
    let mediaRecorder;
    let audioChunks = [];
    let socket;
    let sessionId = null;
    let audioStream;
    let audioContext;
    let audioQueue = [];
    let isPlaying = false;
    
    // Initialize WebSocket connection
    function initWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.hostname}:8765`;
            
            socket = new WebSocket(wsUrl);
            
            socket.onopen = function() {
                console.log('Connected to server WebSocket');
                statusText.textContent = 'Connected to audio server';
            };
            
            socket.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'status') {
                        console.log('Server status:', data.message);
                    } else if (data.type === 'audio_chunk') {
                        // Received audio chunk from server
                        console.log(`Received audio chunk: ${data.chunk_id}`);
                        console.log(`Audio data length: ${data.data.length} characters`);
                        
                        // Add to audio queue for playback
                        audioQueue.push({
                            id: data.chunk_id,
                            data: data.data,
                            timestamp: data.timestamp
                        });
                        
                        // Start playback if not already playing
                        if (!isPlaying) {
                            playAudioQueue();
                        }
                        
                        // Send acknowledgement back to server
                        if (socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({
                                type: 'audio_received',
                                chunk_id: data.chunk_id,
                                received_at: new Date().toISOString()
                            }));
                        }
                    }
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            };
            
            socket.onerror = function(error) {
                console.error('WebSocket error:', error);
                statusText.textContent = 'WebSocket connection error';
            };
            
            socket.onclose = function() {
                console.log('WebSocket connection closed');
                statusText.textContent = 'Disconnected from audio server';
            };
            
        } catch (error) {
            console.error('Error initializing WebSocket:', error);
        }
    }
    
    // Play audio chunks from the queue
    async function playAudioQueue() {
        if (isPlaying || audioQueue.length === 0) return;
        
        isPlaying = true;
        statusText.textContent = 'Playing audio...';
        
        while (audioQueue.length > 0) {
            const audioChunk = audioQueue.shift();
            
            try {
                await playAudioChunk(audioChunk.data);
                console.log(`Played audio chunk: ${audioChunk.id}`);
            } catch (error) {
                console.error('Error playing audio chunk:', error);
            }
        }
        
        isPlaying = false;
        statusText.textContent = 'Audio playback completed';
    }
    
    // Play a single audio chunk
    async function playAudioChunk(base64Audio) {
        return new Promise((resolve, reject) => {
            try {
                // Convert base64 to ArrayBuffer
                const binaryString = atob(base64Audio);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                // Create blob from ArrayBuffer
                const blob = new Blob([bytes], { type: 'audio/mp3' });
                const url = URL.createObjectURL(blob);
                
                // Create audio element
                const audio = new Audio();
                audio.src = url;
                audio.preload = 'auto';
                
                // Set up event handlers
                audio.onended = function() {
                    URL.revokeObjectURL(url);
                    resolve();
                };
                
                audio.onerror = function(error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                };
                
                // Play the audio
                audio.play().catch(error => {
                    URL.revokeObjectURL(url);
                    reject(error);
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Initialize session
    function initSession() {
        fetch('/api/start_session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            sessionId = data.session_id;
            sessionIdElement.textContent = sessionId;
            console.log('Session started:', sessionId);
            statusText.textContent = 'Ready to record';
        })
        .catch(error => {
            console.error('Error starting session:', error);
            statusText.textContent = 'Failed to start session. Check if server is running.';
            addMessage('bot', 'Could not connect to server. Make sure the Flask server is running on port 5000.', true);
        });
    }
    
    function addMessage(sender, text, isError = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `msg ${sender}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        if (isError) {
            bubble.style.color = '#ff6b6b';
        }
        bubble.textContent = text;
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(bubble);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Send audio via HTTP
    function sendAudioViaHTTP(audioBlob) {
        statusText.textContent = 'Sending audio to server...';
        
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.wav');
        
        // Add session ID to headers if available
        const headers = {};
        if (sessionId) {
            headers['X-Session-ID'] = sessionId;
        }
        
        fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
            headers: headers
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errorData => {
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.transcription && data.response) {
                // Add user message (transcription)
                addMessage('user', data.transcription);
                
                // Add AI response
                addMessage('bot', data.response);
                
                statusText.textContent = 'Response received - waiting for audio...';
                
                // Update session ID if returned
                if (data.session_id) {
                    sessionId = data.session_id;
                    sessionIdElement.textContent = sessionId;
                }
            } else if (data.error) {
                console.error('API error:', data.error);
                statusText.textContent = `Error: ${data.error}`;
                addMessage('bot', `Error: ${data.error}`, true);
            }
        })
        .catch(error => {
            console.error('HTTP request failed:', error);
            statusText.textContent = 'Request failed';
            addMessage('bot', `Error: ${error.message}`, true);
        });
    }
    
    // Process and send audio
    function processAndSendAudio() {
        if (audioChunks.length === 0) {
            console.error('No audio data recorded');
            statusText.textContent = 'No audio recorded. Please try again.';
            return;
        }
        
        // Combine all audio chunks
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        
        // Send to server
        sendAudioViaHTTP(audioBlob);
        
        // Clear chunks
        audioChunks = [];
    }
    
    // Check if browser supports media recording
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusText.textContent = 'Browser does not support audio recording';
        addMessage('bot', 'Your browser doesn\'t support audio recording. Please use a modern browser.', true);
        micButton.disabled = true;
        return;
    }
    
    // Initialize WebSocket connection
    initWebSocket();
    
    // Initialize session
    initSession();
    
    // Start recording
    micButton.addEventListener('click', async function() {
        // Toggle recording state
        if (micButton.classList.contains('recording')) {
            // Stop recording
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                micButton.classList.remove('recording');
                statusText.textContent = 'Processing...';
                
                if (audioStream) {
                    audioStream.getTracks().forEach(track => track.stop());
                    audioStream = null;
                }
            }
        } else {
            // Start recording
            try {
                audioStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        channelCount: 1, 
                        echoCancellation: true,
                        noiseSuppression: true
                    } 
                });
                
                let options = {};
                if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                    options.mimeType = 'audio/webm;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/webm')) {
                    options.mimeType = 'audio/webm';
                } else {
                    console.log('Using browser-default audio format');
                }
                
                mediaRecorder = new MediaRecorder(audioStream, options);
                
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                        console.log('Audio chunk received:', event.data.size, 'bytes');
                    }
                };
                
                mediaRecorder.onstop = () => {

                    processAndSendAudio();
                };
                
                mediaRecorder.onerror = (event) => {
                    console.error('MediaRecorder error:', event.error);
                    statusText.textContent = 'Recording error: ' + event.error.name;
                    addMessage('bot', 'Recording error: ' + event.error.name, true);
                };
                
                // Start recording
                mediaRecorder.start(1000); 
                console.log('Recording started with MIME type:', mediaRecorder.mimeType);

                micButton.classList.add('recording');
                statusText.textContent = 'Recording in progress - Speak now';
                
            } catch (error) {
                console.error("Error accessing microphone:", error);
                statusText.textContent = 'Microphone access denied';
                addMessage('bot', 'Could not access your microphone. Please check permissions.', true);

                if (error.name === 'NotAllowedError') {
                    addMessage('bot', 'Please allow microphone access in your browser settings.', true);
                } else if (error.name === 'NotFoundError') {
                    addMessage('bot', 'No microphone found. Please check your audio devices.', true);
                } else if (error.name === 'NotReadableError') {
                    addMessage('bot', 'Microphone is already in use by another application.', true);
                }
            }
        }
    });
    
    // New session button
    newSessionButton.addEventListener('click', function() {

        messagesContainer.innerHTML = '';
        
        audioQueue = [];
        isPlaying = false;
        
        addMessage('bot', 'Hey! Tap the mic and speak — I\'ll respond and keep listening.');
        
        initSession();
    });
});
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
    let receivedAudioChunks = [];
    
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
                        
                        // Store the chunk
                        receivedAudioChunks.push({
                            id: data.chunk_id,
                            data: data.data,
                            timestamp: data.timestamp
                        });
                        
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
    
    // Add message to chat
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
        
        // Scroll to bottom
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
                
                statusText.textContent = 'Response received - streaming audio...';
                
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
                
                // Stop all tracks
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
                        channelCount: 1, // mono
                        echoCancellation: true,
                        noiseSuppression: true
                    } 
                });
                
                // Try to find a supported MIME type
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
                    // Process and send the audio
                    processAndSendAudio();
                };
                
                mediaRecorder.onerror = (event) => {
                    console.error('MediaRecorder error:', event.error);
                    statusText.textContent = 'Recording error: ' + event.error.name;
                    addMessage('bot', 'Recording error: ' + event.error.name, true);
                };
                
                // Start recording
                mediaRecorder.start(1000); // Collect data in 1-second chunks
                console.log('Recording started with MIME type:', mediaRecorder.mimeType);
                
                // Update UI
                micButton.classList.add('recording');
                statusText.textContent = 'Recording in progress - Speak now';
                
            } catch (error) {
                console.error("Error accessing microphone:", error);
                statusText.textContent = 'Microphone access denied';
                addMessage('bot', 'Could not access your microphone. Please check permissions.', true);
                
                // Provide specific guidance based on error
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
        // Clear conversation
        messagesContainer.innerHTML = '';
        
        // Add welcome message
        addMessage('bot', 'Hey! Tap the mic and speak — I\'ll respond and keep listening.');
        
        // Start new session
        initSession();
    });
});

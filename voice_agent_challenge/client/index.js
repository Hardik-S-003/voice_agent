document.addEventListener('DOMContentLoaded', function() {
    const startBtn = document.getElementById('startRecording');
    const stopBtn = document.getElementById('stopRecording');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const transcriptEl = document.getElementById('transcript');
    const responseEl = document.getElementById('response');
    const timerEl = document.getElementById('timer');
    
    let mediaRecorder;
    let audioChunks = [];
    let timerInterval;
    let seconds = 0;
    let sessionId = null;
    let audioStream;
    let audioContext;
    let analyser;
    
    // Debug: Check supported MIME types
    console.log('Supported audio types:');
    console.log('audio/webm;codecs=opus:', MediaRecorder.isTypeSupported('audio/webm;codecs=opus'));
    console.log('audio/webm:', MediaRecorder.isTypeSupported('audio/webm'));
    console.log('audio/mp4:', MediaRecorder.isTypeSupported('audio/mp4'));
    console.log('audio/wav:', MediaRecorder.isTypeSupported('audio/wav'));
    
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
            console.log('Session started:', sessionId);
            statusText.textContent = 'Ready to record';
        })
        .catch(error => {
            console.error('Error starting session:', error);
            statusText.textContent = 'Failed to start session. Check if server is running.';
            responseEl.innerHTML = '<p class="error">Could not connect to server. Make sure the Flask server is running on port 5000.</p>';
        });
    }
    
    // Convert audio to WAV format with proper specifications
    function convertToWav(audioBuffer) {
        try {
            const buffer = audioBuffer.getChannelData(0); // Get mono channel
            const length = buffer.length;
            const wavBuffer = new ArrayBuffer(44 + length * 2);
            const view = new DataView(wavBuffer);
            
            // Write WAV header
            const writeString = function(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            };
            
            writeString(view, 0, 'RIFF'); // RIFF header
            view.setUint32(4, 36 + length * 2, true); // RIFF chunk length
            writeString(view, 8, 'WAVE'); // WAVE header
            writeString(view, 12, 'fmt '); // format chunk identifier
            view.setUint32(16, 16, true); // format chunk length
            view.setUint16(20, 1, true); // sample format (1 = PCM)
            view.setUint16(22, 1, true); // number of channels (mono)
            view.setUint32(24, 16000, true); // sample rate (16kHz)
            view.setUint32(28, 16000 * 2, true); // byte rate (sample rate * bytes per sample * channels)
            view.setUint16(32, 2, true); // block align (bytes per sample * channels)
            view.setUint16(34, 16, true); // bits per sample (16-bit)
            writeString(view, 36, 'data'); // data chunk identifier
            view.setUint32(40, length * 2, true); // data chunk length
            
            // Write audio data
            let offset = 44;
            for (let i = 0; i < length; i++) {
                const sample = Math.max(-1, Math.min(1, buffer[i])); // Clamp to [-1, 1]
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
            
            return new Blob([wavBuffer], { type: 'audio/wav' });
        } catch (error) {
            console.error('Error converting to WAV:', error);
            // Fallback: return the original audio
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            return audioBlob;
        }
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
                transcriptEl.innerHTML = `<p>${data.transcription}</p>`;
                responseEl.innerHTML = `<p>${data.response}</p>`;
                statusText.textContent = 'Response received';
                
                // Update session ID if returned
                if (data.session_id) {
                    sessionId = data.session_id;
                }
            } else if (data.error) {
                console.error('API error:', data.error);
                statusText.textContent = `Error: ${data.error}`;
                responseEl.innerHTML = `<p class="error">Error: ${data.error}</p>`;
            }
        })
        .catch(error => {
            console.error('HTTP request failed:', error);
            statusText.textContent = 'Request failed';
            responseEl.innerHTML = `<p class="error">Error: ${error.message}</p>`;
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
        
        // For now, send the audio as-is and let the server handle conversion
        // In a production app, you'd do the conversion here
        sendAudioViaHTTP(audioBlob);
        
        // Clear chunks
        audioChunks = [];
    }
    
    // Check if browser supports media recording
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser doesn't support audio recording. Please use a modern browser.");
        startBtn.disabled = true;
        responseEl.innerHTML = '<p class="error">Browser does not support audio recording.</p>';
        return;
    }
    
    // Initialize session
    initSession();
    
    // Start recording
    startBtn.addEventListener('click', async function() {
        try {
            // Try to get audio with simple constraints first
            audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1, // mono
                    echoCancellation: true,
                    noiseSuppression: true
                    // Don't specify sampleRate - let browser choose
                } 
            });
            
            // Set up audio monitoring to check if we're getting sound
            audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(audioStream);
            analyser = audioContext.createAnalyser();
            source.connect(analyser);
            
            // Check audio levels
            const checkAudioLevel = () => {
                if (!analyser) return;
                
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(dataArray);
                const volume = Math.max(...dataArray);
                console.log('Audio level:', volume);
                
                if (volume > 5) {
                    console.log('Audio is being captured');
                }
            };
            
            // Check audio levels every second
            const audioCheckInterval = setInterval(checkAudioLevel, 1000);
            
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
                // Stop audio monitoring
                clearInterval(audioCheckInterval);
                if (audioContext) {
                    audioContext.close();
                    audioContext = null;
                }
                
                // Process and send the audio
                processAndSendAudio();
                
                // Stop all tracks
                if (audioStream) {
                    audioStream.getTracks().forEach(track => track.stop());
                    audioStream = null;
                }
            };
            
            mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                statusText.textContent = 'Recording error: ' + event.error.name;
            };
            
            // Start recording
            mediaRecorder.start(1000); // Collect data in 1-second chunks
            console.log('Recording started with MIME type:', mediaRecorder.mimeType);
            
            // Update UI
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusIndicator.classList.add('recording');
            statusText.textContent = 'Recording in progress - Speak now';
            transcriptEl.innerHTML = '<p class="placeholder">Recording... Speak into your microphone</p>';
            responseEl.innerHTML = '<p class="placeholder">Waiting for response...</p>';
            
            // Start timer
            startTimer();
            
        } catch (error) {
            console.error("Error accessing microphone:", error);
            alert("Could not access your microphone. Please check permissions.");
            statusText.textContent = 'Microphone access denied';
            responseEl.innerHTML = '<p class="error">Microphone access denied. Please allow microphone permissions.</p>';
            
            // Provide specific guidance based on error
            if (error.name === 'NotAllowedError') {
                responseEl.innerHTML += '<p>Please allow microphone access in your browser settings.</p>';
            } else if (error.name === 'NotFoundError') {
                responseEl.innerHTML += '<p>No microphone found. Please check your audio devices.</p>';
            } else if (error.name === 'NotReadableError') {
                responseEl.innerHTML += '<p>Microphone is already in use by another application.</p>';
            }
        }
    });
    
    // Stop recording
    stopBtn.addEventListener('click', function() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            
            // Update UI
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusIndicator.classList.remove('recording');
            statusText.textContent = 'Processing...';
            
            // Stop timer
            stopTimer();
        }
    });
    
    // Timer functions
    function startTimer() {
        seconds = 0;
        timerInterval = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = (seconds % 60).toString().padStart(2, '0');
            timerEl.textContent = `${mins}:${secs}`;
        }, 1000);
    }
    
    function stopTimer() {
        clearInterval(timerInterval);
        timerEl.textContent = '00:00';
    }
    
    // Add some CSS for error messages
    const style = document.createElement('style');
    style.textContent = `
        .error {
            color: #e74c3c;
            font-weight: bold;
        }
        .placeholder {
            color: #7f8c8d;
            font-style: italic;
        }
    `;
    document.head.appendChild(style);
});
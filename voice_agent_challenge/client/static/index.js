console.log("🚀 AVA - Advanced Voice Assistant Loaded!");

// Prevent scroll restoration
if (history.scrollRestoration) {
    history.scrollRestoration = 'manual';
}

// App State and Elements
const App = {
    state: {
        mediaRecorder: null,
        audioChunks: [],
        isRecording: false,
        autoRecord: true,
        textOnly: false,
        sessionId: generateSessionId(),
        messageCount: 0,
        audioContext: null,
        analyser: null,
        dataArray: null,
    },
    elements: {},
    config: {
        // Using constants for IDs is a good practice
        API_ENDPOINTS: {
            LLM_QUERY: '/llm/query',
            TEXT_QUERY: '/llm/text-query',
            GENERATE_AUDIO: '/generate-audio/',
        }
    }
};
let animationId = null;

document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Cache all DOM elements at startup
    App.elements = {
        advancedOptionsToggleBtn: document.getElementById('advancedOptionsToggleBtn'),
        advancedOptionsPanel: document.getElementById('advancedOptionsPanel'),
        toggleEchoFeature: document.getElementById('toggleEchoFeature'),
        toggleTtsFeature: document.getElementById('toggleTtsFeature'),
        backToVoiceFromEcho: document.getElementById('backToVoiceFromEcho'),
        backToVoiceFromTts: document.getElementById('backToVoiceFromTts'),
        toggleRecordBtn: document.getElementById('toggleRecordBtn'),
        autoRecordToggleBtn: document.getElementById('autoRecordToggleBtn'),
        textOnlyToggleBtn: document.getElementById('textOnlyToggleBtn'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn'),
        voiceTextInput: document.getElementById('voiceTextInput'),
        voiceSendBtn: document.getElementById('voiceSendBtn'),
        statusText: document.getElementById('statusText'),
        statusContainer: document.getElementById('statusTextContainer'),
        chatHistory: document.getElementById('chat-history'),
        chatHistoryContainer: document.getElementById('chat-history-container'),
        transcriptionContainer: document.getElementById('transcription-container'),
        llmResponseContainer: document.getElementById('llm-response-container'),
        // ... add other frequently used elements here
    };

    console.log('🎯 Initializing AVA...');
    
    // Initialize components
    initializeTabNavigation();
    initializeAIAvatar();
    initializeVoiceChat();
    initializeEchoBot();
    initializeTextToSpeech();
    initializeFloatingParticles();
    updateSessionInfo();

    // Advanced Options interactions
    if (App.elements.advancedOptionsToggleBtn && App.elements.advancedOptionsPanel) {
        App.elements.advancedOptionsToggleBtn.addEventListener('click', () => {
            const panel = App.elements.advancedOptionsPanel;
            const isHidden = panel.style.display === 'none' || panel.style.display === '';
            panel.style.display = isHidden ? 'block' : 'none';
        });
    }

    if (App.elements.toggleEchoFeature) {
        App.elements.toggleEchoFeature.addEventListener('click', () => {
            switchTab('echo-bot');
        });
    }

    if (App.elements.toggleTtsFeature) {
        App.elements.toggleTtsFeature.addEventListener('click', () => {
            switchTab('text-voice');
        });
    }

    // Back buttons in feature tabs
    if (App.elements.backToVoiceFromEcho) {
        App.elements.backToVoiceFromEcho.addEventListener('click', () => switchTab('voice-chat'));
    }
    if (App.elements.backToVoiceFromTts) {
        App.elements.backToVoiceFromTts.addEventListener('click', () => switchTab('voice-chat'));
    }
    
    console.log('✅ AVA initialized successfully!');
}

// Tab Navigation System
// ... (This part is good, but you can apply the same element caching logic)
function initializeTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const tabId = e.target.closest('.tab-button').getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            const tabIndex = parseInt(e.key) - 1;
            const button = tabButtons[tabIndex];
            if (button) {
                const tabId = button.getAttribute('data-tab');
                switchTab(tabId);
            }
        }
    });
}

function switchTab(tabId) {
    // Update tab buttons (if any exist for this tab)
    const allButtons = document.querySelectorAll('.tab-button');
    if (allButtons.length) {
        allButtons.forEach(btn => btn.classList.remove('active'));
        const targetBtn = document.querySelector(`[data-tab="${tabId}"]`);
        if (targetBtn) targetBtn.classList.add('active');
    }
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    
    const newContent = document.getElementById(`${tabId}-tab`);
    if (newContent) {
        newContent.style.display = 'block';
        setTimeout(() => newContent.classList.add('active'), 10);
    } else {
        console.warn(`No content found for tab: ${tabId}`);
    }
    
    // Simple avatar bounce on tab switch
    if (aiAvatar && aiAvatar.avatarBody) {
        aiAvatar.avatarBody.style.animation = 'breathe 4s ease-in-out infinite, avatarBounce 0.6s ease-in-out 1';
        setTimeout(() => {
            aiAvatar.avatarBody.style.animation = 'breathe 4s ease-in-out infinite';
        }, 600);
    }
    
    console.log(`📑 Switched to ${tabId} tab`);
}

// AI Avatar with floating particles
class AIAvatar {
    constructor() {
        this.avatar = document.getElementById('aiAvatar');
        this.leftEye = document.getElementById('leftEye');
        this.rightEye = document.getElementById('rightEye');
        this.avatarBody = this.avatar?.querySelector('.avatar-body');
        this.avatarCore = this.avatar?.querySelector('.avatar-core');
        this.outerRing = this.avatar?.querySelector('.avatar-outer-ring');
        
        // Eye tracking variables
        this.eyeOffsetX = 0;
        this.eyeOffsetY = 0;
        
        this.init();
    }
    
    init() {
        if (!this.avatar) return;
        
        // Mouse tracking for eye movement
        document.addEventListener('mousemove', (e) => this.trackMouse(e));
        
        // Avatar click interactions
        this.avatar.addEventListener('click', () => this.onAvatarClick());
        
        // Start ambient behaviors
        this.startAmbientBehaviors();
        
        console.log('AI Avatar initialized and ready!');
    }
    
    trackMouse(e) {
        if (!this.avatar) return;
        
        const rect = this.avatar.getBoundingClientRect();
        const avatarCenterX = rect.left + rect.width / 2;
        const avatarCenterY = rect.top + rect.height / 2;
        
        const deltaX = e.clientX - avatarCenterX;
        const deltaY = e.clientY - avatarCenterY;
        
        // Calculate eye movement (limited range)
        const maxOffset = 3;
        this.eyeOffsetX = Math.max(-maxOffset, Math.min(maxOffset, deltaX / 50));
        this.eyeOffsetY = Math.max(-maxOffset, Math.min(maxOffset, deltaY / 50));
        
        // Apply eye movement
        this.updateEyePosition();
        
        // Removed avatar tilt to prevent UI positioning issues
    }
    
    updateEyePosition() {
        if (this.leftEye && this.rightEye) {
            this.leftEye.style.transform = `translate(${this.eyeOffsetX}px, ${this.eyeOffsetY}px)`;
            this.rightEye.style.transform = `translate(${this.eyeOffsetX}px, ${this.eyeOffsetY}px)`;
        }
    }
    
    onAvatarClick() {
        // Apply bounce animation to the avatar body instead of the main container
        if (this.avatarBody) {
            this.avatarBody.style.animation = 'breathe 4s ease-in-out infinite, avatarBounce 0.6s ease-in-out 1';
            setTimeout(() => {
                this.avatarBody.style.animation = 'breathe 4s ease-in-out infinite';
            }, 600);
        }
        
        // Show notification in UI instead of just console
        showNotification("Hello! I'm your AI assistant. Ready to explore the future?", 'info');
    }
    
    startAmbientBehaviors() {
        // Subtle random eye movements
        setInterval(() => {
            if (Math.random() < 0.3) {
                const randomX = (Math.random() - 0.5) * 4;
                const randomY = (Math.random() - 0.5) * 4;
                
                if (this.leftEye && this.rightEye) {
                    this.leftEye.style.transform = `translate(${randomX}px, ${randomY}px)`;
                    this.rightEye.style.transform = `translate(${randomX}px, ${randomY}px)`;
                }
                
                // Return to center after a moment
                setTimeout(() => {
                    this.updateEyePosition();
                }, 1500);
            }
        }, 4000);
    }
}

// Global avatar instance
let aiAvatar = null;

// AI Avatar System
function initializeAIAvatar() {
    aiAvatar = new AIAvatar();
}

// Legacy function for compatibility with existing code
function animateAvatar(state) {
    // Simple animation for compatibility
    if (aiAvatar && aiAvatar.avatarBody) {
        aiAvatar.avatarBody.style.animation = 'breathe 4s ease-in-out infinite, avatarBounce 0.6s ease-in-out 1';
        setTimeout(() => {
            aiAvatar.avatarBody.style.animation = 'breathe 4s ease-in-out infinite';
        }, 600);
    }
}

// Voice Chat System
// Example of using the cached elements
function initializeVoiceChat() {
    // No need for `if (element)` checks if you assume they exist from initializeApp
    App.elements.toggleRecordBtn.addEventListener('click', toggleRecording);
    App.elements.autoRecordToggleBtn.addEventListener('click', toggleAutoRecord);
    App.elements.textOnlyToggleBtn.addEventListener('click', toggleTextOnly);
    App.elements.clearHistoryBtn.addEventListener('click', clearChatHistory);
    App.elements.voiceTextInput.addEventListener('keydown', handleVoiceTextKeydown);
    App.elements.voiceSendBtn.addEventListener('click', sendVoiceTextMessage);
}

async function toggleRecording() {
    if (App.state.isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        App.state.mediaRecorder = new MediaRecorder(stream);
        App.state.audioChunks = [];
        
        App.state.mediaRecorder.ondataavailable = (event) => {
            App.state.audioChunks.push(event.data);
        };
        
        App.state.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(App.state.audioChunks, { type: 'audio/wav' });
            await processVoiceInput(audioBlob);
        };
        
        App.state.mediaRecorder.start();
        App.state.isRecording = true;
        
        // Update UI
        updateRecordingUI(true);
        animateAvatar('listening');
        startVisualizer(stream);
        
        console.log('🎤 Recording started');
        
    } catch (error) {
        console.error('❌ Error starting recording:', error);
        showNotification('Failed to start recording. Please check microphone permissions.', 'error');
    }
}

function stopRecording() {
    if (App.state.mediaRecorder && App.state.isRecording) {
        App.state.mediaRecorder.stop();
        App.state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        App.state.isRecording = false;
        
        // Update UI
        updateRecordingUI(false);
        stopVisualizer();
        animateAvatar('thinking');
        
        console.log('⏹️ Recording stopped');
    }
}

function updateRecordingUI(recording) {
    const toggleBtn = document.getElementById('toggleRecordBtn');
    const statusText = document.getElementById('statusText');
    const statusContainer = document.getElementById('statusTextContainer');
    
    if (toggleBtn) {
        if (recording) {
            toggleBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Recording';
            toggleBtn.classList.add('btn-danger');
            toggleBtn.classList.remove('btn-primary');
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-microphone"></i> Start Recording';
            toggleBtn.classList.add('btn-primary');
            toggleBtn.classList.remove('btn-danger');
        }
    }
    
    if (statusText) {
        statusText.textContent = recording ? 'Recording...' : 'Processing...';
    }
    
    if (statusContainer) {
        if (recording) {
            statusContainer.classList.add('recording');
        } else {
            statusContainer.classList.remove('recording');
        }
    }
}

async function processVoiceInput(audioBlob) {
    try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.wav');
        formData.append('session_id', App.state.sessionId);
        
        const response = await fetch(App.config.API_ENDPOINTS.LLM_QUERY, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.error) {
            showNotification(`Error: ${data.error}`, 'error');
        }
        
        // Update UI with results if present
        if (data.userTranscription) displayTranscription(data.userTranscription);
        if (data.llmResponse) displayAIResponse(data.llmResponse);
        if (data.userTranscription) addToChatHistory('user', data.userTranscription);
        if (data.llmResponse) addToChatHistory('assistant', data.llmResponse);
        
        if (data.audioFile) {
            displayAudioPlayer(data.audioFile);
            animateAvatar('speaking');
        }
        
        App.state.messageCount++;
        updateSessionInfo();
        
        // Auto-record next message if enabled
        if (App.state.autoRecord && !data.error) {
            setTimeout(() => {
                if (!App.state.isRecording) {
                    startRecording();
                }
            }, 1000);
        }
        
    } catch (error) {
        console.error('❌ Error processing voice input:', error);
        showNotification('Failed to process voice input', 'error');
    } finally {
        document.getElementById('statusText').textContent = 'Ready to record';
        animateAvatar('neutral');
    }
}

function displayTranscription(text) {
    const container = document.getElementById('transcription-container');
    const textElement = document.getElementById('transcription-text');
    
    if (container && textElement && text) {
        textElement.textContent = text;
        container.classList.add('active');
        container.style.display = 'block';
    }
}

function displayAIResponse(text) {
    const container = document.getElementById('llm-response-container');
    const textElement = document.getElementById('llm-response-text');
    
    if (container && textElement && text) {
        textElement.textContent = text;
        container.classList.add('active');
        container.style.display = 'block';
        
        // Scroll to show the new response
        scrollChatToBottom();
    }
}

function addToChatHistory(role, message) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory || !message) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '' : '';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message;
    
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    
    const icon = document.createElement('i');
    icon.className = `fas ${role === 'user' ? 'fa-microphone' : 'fa-volume-up'} message-icon`;
    
    const time = document.createElement('span');
    time.className = 'message-time';
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    meta.appendChild(icon);
    meta.appendChild(time);
    
    bubble.appendChild(text);
    bubble.appendChild(meta);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    
    chatHistory.appendChild(messageDiv);
    
    // Smooth scroll to bottom with a small delay to ensure content is rendered
    const chatContainer = document.getElementById('chat-history-container');
    setTimeout(() => {
        (chatContainer || chatHistory).scrollTo({
            top: (chatContainer || chatHistory).scrollHeight,
            behavior: 'smooth'
        });
    }, 100);
}

// Helper function to scroll chat history to bottom
function scrollChatToBottom() {
    const chatContainer = document.getElementById('chat-history-container');
    const target = chatContainer || document.getElementById('chat-history');
    if (target) {
        setTimeout(() => {
            target.scrollTo({
                top: target.scrollHeight,
                behavior: 'smooth'
            });
        }, 100);
    }
}

function displayAudioPlayer(audioUrl) {
    const container = document.getElementById('echo-audio-container');
    if (!container || !audioUrl) return;
    
    container.innerHTML = `
        <audio controls autoplay style="width: 100%; max-width: 400px;">
            <source src="${audioUrl}" type="audio/mpeg">
            Your browser does not support the audio element.
        </audio>
    `;
    
    // Scroll to show the audio player
    scrollChatToBottom();
}

function toggleAutoRecord() {
    App.state.autoRecord = !App.state.autoRecord;
    const btn = document.getElementById('autoRecordToggleBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-sync-alt"></i> Auto-Record: ${App.state.autoRecord ? 'ON' : 'OFF'}`;
        btn.classList.toggle('btn-success', App.state.autoRecord);
        btn.classList.toggle('btn-secondary', !App.state.autoRecord);
    }
    
    showNotification(`Auto-record ${App.state.autoRecord ? 'enabled' : 'disabled'}`, 'info');
}

function toggleTextOnly() {
    App.state.textOnly = !App.state.textOnly;
    const btn = document.getElementById('textOnlyToggleBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-comment"></i> Text Only: ${App.state.textOnly ? 'ON' : 'OFF'}`;
        btn.classList.toggle('active', App.state.textOnly);
    }
    
    showNotification(`Text-only mode ${App.state.textOnly ? 'enabled' : 'disabled'}`, 'info');
}

function clearChatHistory() {
    const chatHistory = document.getElementById('chat-history');
    if (chatHistory) {
        chatHistory.innerHTML = '';
    }
    
    // Clear current conversation displays
    const transcriptionContainer = document.getElementById('transcription-container');
    const responseContainer = document.getElementById('llm-response-container');
    
    if (transcriptionContainer) {
        transcriptionContainer.style.display = 'none';
        transcriptionContainer.classList.remove('active');
    }
    
    if (responseContainer) {
        responseContainer.style.display = 'none';
        responseContainer.classList.remove('active');
    }
    
    // Clear audio containers
    const echoAudioContainer = document.getElementById('echo-audio-container');
    const generatedAudioContainer = document.getElementById('generated-audio-container');
    
    if (echoAudioContainer) {
        echoAudioContainer.innerHTML = '';
    }
    
    if (generatedAudioContainer) {
        generatedAudioContainer.innerHTML = '';
        generatedAudioContainer.style.display = 'none';
    }
    
    // Clear text input
    const voiceTextInput = document.getElementById('voiceTextInput');
    if (voiceTextInput) {
        voiceTextInput.value = '';
    }
    
    // Reset session
    App.state.sessionId = generateSessionId();
    App.state.messageCount = 0;
    updateSessionInfo();
    
    showNotification('Chat history cleared', 'info');
}

// Voice Text Input Functions
function handleVoiceTextKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendVoiceTextMessage();
    }
}

async function sendVoiceTextMessage() {
    const input = document.getElementById('voiceTextInput');
    const message = input.value.trim();
    
    if (!message) {
        showNotification('Please enter a message', 'warning');
        return;
    }
    
    // Clear input
    input.value = '';
    
    try {
        // Add user message to chat history
        addToChatHistory('user', message);
        displayTranscription(message);
        animateAvatar('thinking');
        
        // Send to LLM for text response
        const textResponse = await fetch(App.config.API_ENDPOINTS.TEXT_QUERY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: message,
                session_id: App.state.sessionId
            })
        });
        
        const textData = await textResponse.json();
        
        if (textData.error) {
            showNotification(`Error: ${textData.error}`, 'error');
            return;
        }
        
        // Display AI response
        displayAIResponse(textData.llmResponse);
        addToChatHistory('assistant', textData.llmResponse);
        
        // Generate audio from AI response (only if text-only mode is disabled)
        if (!App.state.textOnly) {
            const audioResponse = await fetch(App.config.API_ENDPOINTS.GENERATE_AUDIO, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: textData.llmResponse
                })
            });
            
            const audioData = await audioResponse.json();
            
            if (audioData.audioFile) {
                displayAudioPlayer(audioData.audioFile);
                animateAvatar('speaking');
            }
        }
        
        App.state.messageCount++;
        updateSessionInfo();
        
    } catch (error) {
        console.error('❌ Error sending text message:', error);
        showNotification('Failed to send message', 'error');
    } finally {
        animateAvatar('neutral');
    }
}

// Echo Bot System
function initializeEchoBot() {
    const startBtn = document.getElementById('startEchoBtn');
    const stopBtn = document.getElementById('stopEchoBtn');
    
    if (startBtn) {
        startBtn.addEventListener('click', startEcho);
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', stopEcho);
    }
}

async function startEcho() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        App.state.mediaRecorder = new MediaRecorder(stream);
        App.state.audioChunks = [];
        
        App.state.mediaRecorder.ondataavailable = (event) => {
            App.state.audioChunks.push(event.data);
        };
        
        App.state.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(App.state.audioChunks, { type: 'audio/wav' });
            await processEcho(audioBlob);
        };
        
        App.state.mediaRecorder.start();
        
        // Update UI
        document.getElementById('startEchoBtn').disabled = true;
        document.getElementById('stopEchoBtn').disabled = false;
        document.getElementById('echoStatus').textContent = 'Recording echo...';
        document.getElementById('echoStatus').classList.add('recording');
        
        animateAvatar('listening');
        
    } catch (error) {
        console.error('❌ Error starting echo:', error);
        showNotification('Failed to start echo recording', 'error');
    }
}

function stopEcho() {
    if (App.state.mediaRecorder) {
        App.state.mediaRecorder.stop();
        App.state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        // Update UI
        document.getElementById('startEchoBtn').disabled = false;
        document.getElementById('stopEchoBtn').disabled = true;
        document.getElementById('echoStatus').textContent = 'Processing echo...';
        document.getElementById('echoStatus').classList.remove('recording');
        
        animateAvatar('thinking');
    }
}

async function processEcho(audioBlob) {
    try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'echo.wav');
        
        const response = await fetch('/tts/echo/', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        // Show error but keep going to use fallback
        if (data.error) {
            showNotification(`Echo error: ${data.error}`, 'error');
        }
        
        // Display transcription if present
        const transcriptionContainer = document.getElementById('echo-transcription-container');
        const transcriptionText = document.getElementById('echo-transcription-text');
        if (transcriptionContainer && transcriptionText && data.transcription) {
            transcriptionText.textContent = data.transcription;
            transcriptionContainer.style.display = 'block';
            transcriptionContainer.classList.add('active');
        }
        
        // Display audio player including fallback
        if (data.audioFile) {
            const playerContainer = document.getElementById('echo-player-container');
            if (playerContainer) {
                playerContainer.innerHTML = `
                    <audio controls autoplay style="width: 100%; max-width: 400px;">
                        <source src="${data.audioFile}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                `;
            }
            animateAvatar('speaking');
        }
        
    } catch (error) {
        console.error('❌ Error processing echo:', error);
        showNotification('Failed to process echo', 'error');
    } finally {
        document.getElementById('echoStatus').textContent = 'Ready for echo';
        animateAvatar('neutral');
    }
}

// Text to Speech System
function initializeTextToSpeech() {
    const exploreBtn = document.getElementById('exploreBtn');
    const thoughtInput = document.getElementById('thoughtInput');
    
    if (exploreBtn) {
        exploreBtn.addEventListener('click', generateSpeech);
    }
    
    if (thoughtInput) {
        thoughtInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                generateSpeech();
            }
        });
    }
}

async function generateSpeech() {
    const input = document.getElementById('thoughtInput');
    const text = input?.value.trim();
    
    if (!text) {
        showNotification('Please enter some text to convert to speech', 'warning');
        return;
    }
    
    try {
        const btn = document.getElementById('exploreBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        }
        
        animateAvatar('thinking');
        
        const response = await fetch('/generate-audio/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showNotification(`Error: ${data.error}`, 'error');
        }
        
        // Display audio player for generated or fallback audio
        const container = document.getElementById('generated-audio-container');
        if (container && data.audioFile) {
            container.innerHTML = `
                <audio controls autoplay style="width: 100%; max-width: 400px;">
                    <source src="${data.audioFile}" type="audio/mpeg">
                    Your browser does not support the audio element.
                </audio>
            `;
            container.style.display = 'flex';
            animateAvatar('speaking');
        }
        
    } catch (error) {
        console.error('❌ Error generating speech:', error);
        showNotification('Failed to generate speech', 'error');
    } finally {
        const btn = document.getElementById('exploreBtn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-volume-up"></i> Generate Voice';
        }
        animateAvatar('neutral');
    }
}

// AI Text Chat System
function initializeAIChat() {
    const askBtn = document.getElementById('askLLMBtn');
    const clearBtn = document.getElementById('clearChatBtn');
    const input = document.getElementById('llmInput');
    
    if (askBtn) {
        askBtn.addEventListener('click', askAI);
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearTextChat);
    }
    
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askAI();
            }
        });
        
        // Auto-resize textarea as user types and update character counter
        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 150) + 'px';
            
            // Update character counter
            const charCounter = document.getElementById('charCounter');
            if (charCounter) {
                const count = this.value.length;
                const max = this.maxLength || 2000;
                charCounter.textContent = `${count}/${max}`;
                
                // Change color when approaching limit
                if (count > max * 0.9) {
                    charCounter.style.color = '#f5576c';
                } else if (count > max * 0.7) {
                    charCounter.style.color = '#fee140';
                } else {
                    charCounter.style.color = 'var(--text-muted)';
                }
            }
        });
    }
}

async function askAI() {
    const input = document.getElementById('llmInput');
    const question = input?.value.trim();
    
    if (!question) {
        showNotification('Please enter a question for the AI', 'warning');
        return;
    }
    
    try {
        const btn = document.getElementById('askLLMBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Thinking...';
        }
        
        animateAvatar('thinking');
        
        // Add user message to chat immediately
        addToTextChatHistory('user', question);
        
        // Add typing indicator
        const typingIndicator = addTypingIndicator();
        
        // Call the text-only LLM endpoint
        const response = await fetch('/llm/text-query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: question,
                session_id: App.state.sessionId
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Failed to get AI response');
        }
        
        // Remove typing indicator and add AI response
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        if (data.llmResponse) {
            addToTextChatHistory('assistant', data.llmResponse);
        }
        
        // Clear input
        if (input) {
            input.value = '';
            input.focus(); // Keep focus on input for continuous conversation
        }
        
        showNotification('AI response received!', 'success');
        
    } catch (error) {
        console.error('❌ Error asking AI:', error);
        showNotification(`Failed to get AI response: ${error.message}`, 'error');
        
        // Remove typing indicator and add error message
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        addToTextChatHistory('assistant', `Sorry, I encountered an error: ${error.message}. Please try again.`);
    } finally {
        const btn = document.getElementById('askLLMBtn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-brain"></i> Ask AI';
        }
        animateAvatar('neutral');
    }
}

function addToTextChatHistory(role, message) {
    const chatHistory = document.getElementById('text-chat-history');
    if (!chatHistory || !message) return;
    
    // Remove the welcome message if it exists
    const welcomeMessage = chatHistory.querySelector('[style*="text-align: center"]');
    if (welcomeMessage) {
        welcomeMessage.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '' : '';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role === 'user' ? 'You' : 'AVA';
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message;
    
    content.appendChild(roleLabel);
    content.appendChild(text);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    
    chatHistory.appendChild(messageDiv);
    
    // Scroll to bottom
    const container = document.getElementById('text-chat-history-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
    
    console.log(`💬 Text Chat - ${role}: ${message}`);
}

function addTypingIndicator() {
    const chatHistory = document.getElementById('text-chat-history');
    if (!chatHistory) return null;
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant typing-indicator';
    typingDiv.id = 'typing-indicator';
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = 'AVA';
    
    const text = document.createElement('div');
    text.className = 'message-text typing-dots';
    text.innerHTML = '<span></span><span></span><span></span>';
    
    content.appendChild(roleLabel);
    content.appendChild(text);
    typingDiv.appendChild(avatar);
    typingDiv.appendChild(content);
    
    chatHistory.appendChild(typingDiv);
    
    // Scroll to bottom
    const container = document.getElementById('text-chat-history-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
    
    return typingDiv;
}

async function clearTextChat() {
    const container = document.getElementById('text-chat-response-container');
    const input = document.getElementById('llmInput');
    const chatHistory = document.getElementById('text-chat-history');
    
    // Clear UI elements
    if (container) {
        container.style.display = 'none';
        container.classList.remove('active');
    }
    
    if (input) {
        input.value = '';
    }
    
    // Clear chat history and restore welcome message
    if (chatHistory) {
        chatHistory.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); font-size: 0.875rem; padding: var(--spacing-lg);">
                <i class="fas fa-comments" style="font-size: 2rem; margin-bottom: var(--spacing-sm);"></i>
                <p>Start a conversation with AVA!</p>
            </div>
        `;
    }
    
    // Clear the session history on the server
    try {
        const response = await fetch('/chat/clear', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: App.state.sessionId
            })
        });
        
        if (response.ok) {
            showNotification('Text chat and history cleared', 'success');
        } else {
            showNotification('Text chat cleared (history clear failed)', 'warning');
        }
    } catch (error) {
        console.error('❌ Error clearing chat history:', error);
        showNotification('Text chat cleared (history clear failed)', 'warning');
    }
}

// Visualizer System
function startVisualizer(stream) {
    const canvas = document.getElementById('recordingVisualizer');
    const wrapper = document.getElementById('visualizerWrapper');
    
    if (!canvas || !wrapper) return;
    
    wrapper.classList.add('active');
    wrapper.style.display = 'block';
    
    App.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    App.state.analyser = App.state.audioContext.createAnalyser();
    const source = App.state.audioContext.createMediaStreamSource(stream);
    
    source.connect(App.state.analyser);
    App.state.analyser.fftSize = 256;
    
    const bufferLength = App.state.analyser.frequencyBinCount;
    App.state.dataArray = new Uint8Array(bufferLength);
    
    const ctx = canvas.getContext('2d');
    
    function draw() {
        if (!App.state.isRecording) return;
        
        animationId = requestAnimationFrame(draw);
        
        App.state.analyser.getByteFrequencyData(App.state.dataArray);
        
        ctx.fillStyle = 'rgba(10, 10, 15, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = (App.state.dataArray[i] / 255) * canvas.height;
            
            const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#764ba2');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    draw();
}

function stopVisualizer() {
    const wrapper = document.getElementById('visualizerWrapper');
    
    if (wrapper) {
        wrapper.classList.remove('active');
        wrapper.style.display = 'none';
    }
    
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    if (App.state.audioContext) {
        App.state.audioContext.close();
        App.state.audioContext = null;
    }
}

// Utility Functions
function generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

function updateSessionInfo() {
    const shortSessionElement = document.getElementById('shortSessionId');
    const messageCountElement = document.getElementById('messageCount');
    
    if (shortSessionElement) {
        const shortId = App.state.sessionId.split('_')[1]?.substr(0, 6) || 'unknown';
        shortSessionElement.textContent = shortId;
    }
    
    if (messageCountElement) {
        messageCountElement.textContent = App.state.messageCount.toString();
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        color: var(--text-primary);
        font-size: 0.875rem;
        font-weight: 500;
        z-index: 1000;
        backdrop-filter: blur(20px);
        animation: slideIn 0.3s ease;
        max-width: 300px;
        box-shadow: var(--shadow-lg);
    `;
    
    // Add type-specific styling
    if (type === 'error') {
        notification.style.borderColor = '#f5576c';
        notification.style.background = 'rgba(245, 87, 108, 0.1)';
    } else if (type === 'success') {
        notification.style.borderColor = '#43e97b';
        notification.style.background = 'rgba(67, 233, 123, 0.1)';
    } else if (type === 'warning') {
        notification.style.borderColor = '#fee140';
        notification.style.background = 'rgba(254, 225, 64, 0.1)';
    }
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Add CSS for notifications
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(notificationStyles);

// Global error handling
window.addEventListener('error', (e) => {
    console.error('❌ Global error:', e.error);
    showNotification('An unexpected error occurred', 'error');
});

// Floating Particles System
function initializeFloatingParticles() {
    const particlesContainer = document.getElementById('particles');
    if (!particlesContainer) return;
    
    const particleTypes = ['small', 'medium', 'large'];
    const colors = [
        'rgba(102, 126, 234, 0.6)',
        'rgba(245, 87, 108, 0.5)',
        'rgba(79, 172, 254, 0.4)',
        'rgba(67, 233, 123, 0.5)'
    ];
    
    function createParticle() {
        const particle = document.createElement('div');
        particle.className = `particle ${particleTypes[Math.floor(Math.random() * particleTypes.length)]}`;
        
        // Random position
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDuration = (Math.random() * 10 + 10) + 's';
        particle.style.animationDelay = Math.random() * 5 + 's';
        
        // Random color
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        
        // Add some horizontal drift
        particle.style.setProperty('--drift', (Math.random() - 0.5) * 100 + 'px');
        
        particlesContainer.appendChild(particle);
        
        // Remove particle after animation
        setTimeout(() => {
            if (particle.parentNode) {
                particle.parentNode.removeChild(particle);
            }
        }, 20000);
    }
    
    // Create initial particles
    for (let i = 0; i < 15; i++) {
        setTimeout(() => createParticle(), i * 1000);
    }
    
    // Continuously create new particles
    setInterval(createParticle, 2000);
    
    console.log('🌟 Floating particles initialized');
}

// Service worker registration (same scope as start_url)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => console.log('Service worker registered', reg))
            .catch(err => console.error('Service worker registration failed', err));
    });
}

console.log('Agent script loaded successfully!');
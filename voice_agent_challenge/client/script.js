console.log("🚀 Kira - The God of Justice");

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
        ws: null,
        // Dedup guard for chat messages
        lastChat: {
            user: { text: null, at: 0 },
            assistant: { text: null, at: 0 }
        },
        receivedAudioB64: [],
        previewIsPlaying: false,
        ttsQueuedUrl: null,
    },
    elements: {},
    config: {
        // Using constants for IDs is a good practice
        API_ENDPOINTS: {
            LLM_QUERY: '/llm/query',
            TEXT_QUERY: '/llm/text-query',
            GENERATE_AUDIO: '/generate-audio/',
            SESSIONS: '/sessions',
        }
    }
};
let animationId = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Hint for better mic reliability in PWAs
    if (!window.isSecureContext) {
        try { showNotification('For reliable microphone access in PWA, use HTTPS.', 'warning', 6000); } catch {}
    }
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
        stopPlaybackBtn: document.getElementById('stopPlaybackBtn'),
        // Sidebar elements
        leftSidebar: document.getElementById('leftSidebar'),
        sidebarToggle: document.getElementById('sidebarToggle'),
        newChatBtn: document.getElementById('newChatBtn'),
        sessionSearch: document.getElementById('sessionSearch'),
        sessionList: document.getElementById('sessionList'),
        pinnedList: document.getElementById('pinnedList'),
        openSettingsFromSidebar: document.getElementById('openSettingsFromSidebar'),
    };

    // Restore last session id if any
    try {
        const sid = localStorage.getItem('ava.sessionId');
        if (sid) { App.state.sessionId = sid; }
    } catch {}

    console.log('🎯 Initializing KIRA...');
    
    // Debug: Check if audio container exists
    const audioContainer = document.getElementById('echo-audio-container');
    console.log('🔍 Audio container check during init:', audioContainer ? 'FOUND' : 'NOT FOUND');
    if (audioContainer) {
        console.log('📍 Audio container element:', audioContainer);
        console.log('📍 Audio container parent:', audioContainer.parentElement);
    }
    
    // Initialize components
    initializeTabNavigation();
    initializeAIAvatar();
    initializeVoiceChat();
    initializeEchoBot();
    initializeTextToSpeech();
    initializeAIChat();
    initializeFloatingParticles();
    updateSessionInfo();

    // Sidebar init
    try { initializeSidebar(); } catch (e) { console.warn('Sidebar init failed', e); }

    // Mobile/global hamburger toggling (overlay style)
    try {
        const btn = document.getElementById('globalSidebarBtn');
        const sb = document.getElementById('leftSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        const headerBtn = btn; // same element
        function setExpanded(on) {
            if (!sb) return;
            sb.classList.toggle('expanded', !!on);
            if (headerBtn) headerBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
            if (backdrop) backdrop.classList.toggle('active', !!on);
        }
        if (btn && sb) {
            btn.addEventListener('click', () => setExpanded(!sb.classList.contains('expanded')));
        }
        if (backdrop) {
            backdrop.addEventListener('click', () => setExpanded(false));
            // Close on ESC
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') setExpanded(false);
            });
        }
        // Auto-collapse on navigation/resize for small screens
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 1024) setExpanded(false);
        });
    } catch (e) { console.warn('Global sidebar toggle init failed', e); }

    // Wire up stop playback button if present
    if (App.elements.stopPlaybackBtn) {
        App.elements.stopPlaybackBtn.addEventListener('click', stopPlayback);
    }

    // Settings modal binding
    bindSettingsModal();

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
    
    console.log('✅ KIRA initialized successfully!');
}

// --- Settings Modal ---
function bindSettingsModal() {
    const modal = document.getElementById('settingsModal');
    const openBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsCloseBtn');
    const cancelBtn = document.getElementById('settingsCancelBtn');
    const saveBtn = document.getElementById('settingsSaveBtn');

    function open() { if (modal) { modal.style.display = 'flex'; modal.setAttribute('aria-hidden', 'false'); } }
    function close() { if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); } }

    // On open, fetch status to toggle encryption hint
    async function openWithStatus() {
        try {
            const res = await fetch('/config/api-keys');
            const data = await res.json();
            const hint = document.getElementById('encryptionHint');
            if (hint) {
                hint.style.display = data?.encryption ? 'flex' : 'none';
            }
        } catch {}
        open();
    }

    if (openBtn) openBtn.addEventListener('click', openWithStatus);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const payload = {
                MURF_API_KEY: document.getElementById('key_murf')?.value || undefined,
                ASSEMBLYAI_API_KEY: document.getElementById('key_assembly')?.value || undefined,
                GEMINI_API_KEY: document.getElementById('key_gemini')?.value || undefined,
                SERPAPI_KEY: document.getElementById('key_serpapi')?.value || undefined,
                WEATHER_API_KEY: document.getElementById('key_weather')?.value || undefined,
            };
            try {
                const res = await fetch('/config/api-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) throw new Error('Failed to save API keys');
                showNotification('API keys saved for this session', 'success');
                close();
            } catch (e) {
                console.error('Failed to save API keys', e);
                showNotification('Failed to save API keys', 'error');
            }
        });
    }
}

// --- UI Utilities: Notifications & Audio Player ---
function ensureToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.position = 'fixed';
        container.style.top = '16px';
        container.style.right = '16px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';
        document.body.appendChild(container);
    }
    return container;
}

function showNotification(message, type = 'info', durationMs = 4000) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.style.minWidth = '240px';
    toast.style.maxWidth = '360px';
    toast.style.padding = '10px 12px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.15)';
    toast.style.color = '#111';
    toast.style.background = '#e8f0fe';
    toast.style.border = '1px solid #c6dafc';
    if (type === 'error') { toast.style.background = '#fdecea'; toast.style.border = '1px solid #f5c6cb'; }
    if (type === 'warning') { toast.style.background = '#fff4e5'; toast.style.border = '1px solid #ffe8b3'; }
    if (type === 'success') { toast.style.background = '#eaf7ea'; toast.style.border = '1px solid #c6e6c6'; }
    toast.style.fontSize = '14px';
    toast.style.lineHeight = '1.3';
    toast.style.display = 'flex';
    toast.style.alignItems = 'flex-start';
    toast.style.gap = '8px';

    const icon = document.createElement('span');
    icon.textContent = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    icon.style.marginTop = '2px';
    const text = document.createElement('div');
    text.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(text);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = 'opacity 200ms ease';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 220);
    }, durationMs);
}

function displayAudioPlayer(url) {
    const container = document.getElementById('echo-audio-container')
        || document.getElementById('generated-audio-container')
        || document.getElementById('echo-player-container');
    if (!container) {
        console.warn('No audio container found to display audio');
        return;
    }
    container.style.display = 'block';
    container.innerHTML = `
        <audio id="ava-audio-player" controls autoplay style="width: 100%; max-width: 420px; border-radius: 8px;">
            <source src="${url}" type="audio/mpeg">
            <source src="${url}" type="audio/wav">
            Your browser does not support the audio element.
        </audio>
    `;

    // Mark preview as playing and suspend TTS
    try {
        App.state.previewIsPlaying = true;
        // Pause streaming TTS during preview
        if (App.state.ttsAudioContext && App.state.ttsAudioContext.state === 'running') {
            App.state.ttsAudioContext.suspend().catch(()=>{});
        }
    } catch {}

    // Hook play/pause/end events to manage TTS queueing
    try {
        const el = document.getElementById('ava-audio-player');
        if (el) {
            el.addEventListener('ended', () => {
                App.state.previewIsPlaying = false;
                resumeTTSIfQueued();
            });
            el.addEventListener('pause', () => {
                // If user paused before end, allow TTS to resume on demand
                if (el.currentTime > 0 && !el.ended) {
                    App.state.previewIsPlaying = false;
                    resumeTTSIfQueued();
                }
            });
        }
    } catch {}
}

// Stop current playback and streaming audio cleanly
function stopPlayback() {
    try {
        // Stop the Murf HTML5 audio element if present
        const el = document.getElementById('ava-audio-player');
        if (el && !el.paused) { el.pause(); el.currentTime = 0; }
    } catch {}

    // Stop streaming TTS playback
    try { App.state.ttsPendingChunks = []; } catch {}
    try { App.state.ttsIsPlaying = false; } catch {}
    try { App.state.receivedAudioB64 = []; } catch {}
    try { App.state.ttsQueuedUrl = null; } catch {}
    // Best-effort: close or suspend the streaming AudioContext
    try { if (App.state.ttsAudioContext) { App.state.ttsAudioContext.close(); App.state.ttsAudioContext = null; } } catch {}

    // Optional: reflect status text succinctly
    try { const s = document.getElementById('statusText'); if (s) s.textContent = 'Playback stopped'; } catch {}

    // Keep UI intact; no other changes
}

// Resume TTS if a URL is queued after preview ends
function resumeTTSIfQueued() {
    try {
        if (App.state.previewIsPlaying) return;
        if (App.state.ttsAudioContext && App.state.ttsAudioContext.state === 'suspended') {
            App.state.ttsAudioContext.resume().catch(()=>{});
        }
        if (Array.isArray(App.state.ttsPendingChunks) && App.state.ttsPendingChunks.length && !App.state.ttsIsPlaying) {
            // Re-run the same chunk playback loop logic
            App.state.ttsIsPlaying = true;
            const evt = new Event('resume-tts');
            document.dispatchEvent(evt);
        }
    } catch {}
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
        
        console.log('⚖️ AI Avatar initialized and ready!');
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

// Permission helpers for microphone (mobile/PWA friendly)
async function ensureMicrophonePermission() {
    // If permission is already granted, just open a quick stream and return it
    try {
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const status = await navigator.permissions.query({ name: 'microphone' });
                if (status.state === 'granted') {
                    return await navigator.mediaDevices.getUserMedia({ audio: true });
                }
            } catch {}
        }
        // Request explicitly in response to user gesture
        return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        // Surface a friendly notification
        try { showNotification('Microphone access is required. Please allow permission.', 'warning'); } catch {}
        throw e;
    }
}

let micWarmupTried = false;
async function warmUpMicPermission() {
    if (micWarmupTried) return;
    micWarmupTried = true;
    try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks to release the mic until recording begins
        try { s.getTracks().forEach(t => t.stop()); } catch {}
        try { showNotification('Microphone ready', 'success', 1500); } catch {}
    } catch (e) {
        console.warn('Warm-up mic permission failed:', e);
    }
}

// --- Sidebar (Sessions) ---
function initializeSidebar() {
    const sb = App.elements.leftSidebar;
    if (!sb) return; // no-op if markup missing
    const toggle = App.elements.sidebarToggle;
    const newBtn = App.elements.newChatBtn;
    const searchEl = App.elements.sessionSearch;
    const listEl = App.elements.sessionList;
    const pinnedEl = App.elements.pinnedList;

    // Toggle expand/collapse
    if (toggle) {
        toggle.addEventListener('click', () => {
            const expanded = sb.classList.toggle('expanded');
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
    }

    // Open settings from sidebar
    if (App.elements.openSettingsFromSidebar) {
        App.elements.openSettingsFromSidebar.addEventListener('click', () => {
            document.getElementById('settingsBtn')?.click();
        });
    }

    // Load sessions initial
    refreshSessions();

    // New Chat
    if (newBtn) {
        newBtn.addEventListener('click', async () => {
            try {
                const res = await fetch(App.config.API_ENDPOINTS.SESSIONS, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const data = await res.json();
                if (res.ok && data?.id) {
                    App.state.sessionId = data.id;
                    App.state.messageCount = 0;
                    updateSessionInfo();
                    clearChatUI();
                    // Persist session id for server use if needed
                    try { localStorage.setItem('ava.sessionId', App.state.sessionId); } catch {}
                    showNotification('New chat created', 'success');
                    refreshSessions();
                } else {
                    showNotification('Failed to create chat', 'error');
                }
            } catch (e) {
                console.error('create session failed', e);
                showNotification('Failed to create chat', 'error');
            }
        });
    }

    // Search debounce
    if (searchEl) {
        let t = null;
        searchEl.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => refreshSessions(), 250);
        });
    }

    async function refreshSessions() {
        try {
            const q = searchEl?.value?.trim();
            const url = q ? `${App.config.API_ENDPOINTS.SESSIONS}?q=${encodeURIComponent(q)}` : App.config.API_ENDPOINTS.SESSIONS;
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'load sessions failed');
            renderSessions(data.sessions || []);
        } catch (e) {
            console.warn('sessions load failed', e);
        }
    }

    function renderSessions(rows) {
        if (!listEl) return;
        listEl.innerHTML = '';
        if (pinnedEl) pinnedEl.innerHTML = '';
        let hasPinned = false;
        (rows || []).forEach((s) => {
            const li = document.createElement('li');
            li.className = 'session-item';
            li.innerHTML = `
                <div class="session-title" title="${escapeHtml(s.title || s.id)}">${escapeHtml(s.title || s.id)}</div>
                <div class="session-meta">${s.last_message ? escapeHtml(s.last_message) : ''}</div>
                <div class="session-actions">
                    <button class="icon-btn" title="Pin"><i class="fas fa-thumbtack"></i></button>
                    <button class="icon-btn" title="Rename"><i class="fas fa-edit"></i></button>
                    <button class="icon-btn" title="Delete"><i class="fas fa-trash"></i></button>
                </div>`;
            // Click to open
            li.addEventListener('click', async (ev) => {
                if (ev.target.closest('.icon-btn')) return; // ignore when clicking inline actions
                App.state.sessionId = s.id;
                try { localStorage.setItem('ava.sessionId', App.state.sessionId); } catch {}
                App.state.messageCount = 0; // will be set after fetch
                updateSessionInfo();
                await loadMessages(s.id);
                showNotification('Session loaded', 'success', 1500);
            });
            // Inline actions
            const btns = li.querySelectorAll('.icon-btn');
            // Pin
            btns[0]?.addEventListener('click', async (e) => {
                e.stopPropagation();
                await patchSession(s.id, { pinned: !s.pinned });
                refreshSessions();
            });
            // Rename
            btns[1]?.addEventListener('click', async (e) => {
                e.stopPropagation();
                const title = prompt('Rename session', s.title || '');
                if (title !== null) {
                    await patchSession(s.id, { title });
                    refreshSessions();
                }
            });
            // Delete
            btns[2]?.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Delete this session?')) {
                    await deleteSession(s.id);
                    if (App.state.sessionId === s.id) {
                        App.state.sessionId = generateSessionId();
                        updateSessionInfo();
                        clearChatUI();
                    }
                    refreshSessions();
                }
            });
            if (s.pinned && pinnedEl) {
                hasPinned = true;
                pinnedEl.appendChild(li);
            } else {
                listEl.appendChild(li);
            }
        });
        const pinnedBlock = document.getElementById('pinnedSection');
        if (pinnedBlock) pinnedBlock.style.display = hasPinned ? 'block' : 'none';
    }

    async function loadMessages(sid) {
        try {
            const res = await fetch(`${App.config.API_ENDPOINTS.SESSIONS}/${encodeURIComponent(sid)}/messages`);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'load messages failed');
            clearChatUI();
            const msgs = data.messages || [];
            App.state.messageCount = msgs.length;
            updateSessionInfo();
            // Render messages into voice chat history panel
            msgs.forEach(m => {
                const role = m.role === 'assistant' ? 'assistant' : 'user';
                addToChatHistory(role, m.content);
            });
        } catch (e) {
            console.warn('messages load failed', e);
        }
    }

    async function patchSession(id, payload) {
        try {
            await fetch(`${App.config.API_ENDPOINTS.SESSIONS}/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } catch {}
    }

    async function deleteSession(id) {
        try {
            await fetch(`${App.config.API_ENDPOINTS.SESSIONS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch {}
    }
}

function clearChatUI() {
    try { if (App.elements.chatHistory) App.elements.chatHistory.innerHTML = ''; } catch {}
}

function escapeHtml(str) {
    try {
        return String(str).replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
    } catch { return str; }
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

    // Proactively warm up permission on first interaction (PWA/mobile friendly)
    App.elements.toggleRecordBtn.addEventListener('touchstart', warmUpMicPermission, { passive: true });
    App.elements.toggleRecordBtn.addEventListener('pointerdown', warmUpMicPermission, { passive: true });
}

async function toggleRecording() {
    if (App.state.isRecording) {
        stopRecording();
    } else {
        // BARGE-IN: stop any current playback as user explicitly toggles mic on
        try { stopPlayback(); } catch {}
        // Ask for microphone permission on user gesture (works in PWA/mobile)
        let preStream = null;
        try {
            preStream = await ensureMicrophonePermission();
        } catch (e) {
            console.warn('Microphone permission not granted:', e);
            return; // Abort start when permission denied/blocked
        }
        await startRecording(preStream);
    }
}

async function startRecording(existingStream = null) {
    try {
        // Use pre-acquired stream if available, otherwise request now
        const stream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });

        // BARGE-IN: stop any current playback immediately when mic starts listening
        try { stopPlayback(); } catch {}
        try { if (typeof animateAvatar === 'function') animateAvatar('listening'); } catch {}
        const statusEl0 = document.getElementById('statusText');
        if (statusEl0) statusEl0.textContent = 'Listening...';
        
        App.state.mediaRecorder = new MediaRecorder(stream);
        App.state.audioChunks = [];
        App.state.closeWsAfterTurn = false;
        
        App.state.mediaRecorder.ondataavailable = (event) => {
            // Not storing chunks during realtime streaming to avoid memory buildup
        };
        
        App.state.mediaRecorder.onstop = async () => {
            // Defer socket close until we receive final end_of_turn
            App.state.closeWsAfterTurn = true;
        };
        
        // Open WebSocket connection
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        App.state.ws = new WebSocket(`${protocol}://${location.host}/ws?session=${encodeURIComponent(App.state.sessionId)}`);
        // Handle transcript streaming messages
        App.state.ws.onopen = () => {
            const statusEl = document.getElementById('statusText');
            if (statusEl) statusEl.textContent = 'Listening...';
        };
        
        // RULE: If the user starts speaking (mic on), stop all current playback
        // Already executed above via stopPlayback() before opening WS
        // We keep this comment to document barge-in behavior
        
        App.state.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg && msg.type === 'transcript') {
                    const statusEl = document.getElementById('statusText');
                    // Show partials live in the status only
                    if (!msg.end_of_turn) {
                       if (statusEl) statusEl.textContent = msg.text || 'Listening...';
                        return;
                    }

                    // Only commit the message when it's a final formatted turn
                    if (msg.end_of_turn && msg.formatted && msg.text) {
                        // Dedup: avoid double appending the same final text within 3 seconds
                        const now = Date.now();
                        const last = App.state.lastChat.user;
                        if (!(last.text === msg.text && (now - last.at) < 3000)) {
                            addToChatHistory('user', msg.text);
                            App.state.lastChat.user = { text: msg.text, at: now };
                             App.state.messageCount++;
                            updateSessionInfo();
                        }
                        if (statusEl) statusEl.textContent = 'Processing...';
                        try { showNotification('Final turn received', 'success'); } catch {}
                        if (App.state.closeWsAfterTurn && App.state.ws && App.state.ws.readyState === WebSocket.OPEN) {
                            App.state.ws.close();
                            App.state.closeWsAfterTurn = false;
                        }
                    }
                } else if (msg && msg.type === 'assistant') {
                    // Server-sent assistant response (post-LLM)
                    if (msg.text) {
                        const now = Date.now();
                        const last = App.state.lastChat.assistant;
                        if (!(last.text === msg.text && (now - last.at) < 3000)) {
                            addToChatHistory('assistant', msg.text);
                            App.state.lastChat.assistant = { text: msg.text, at: now };
                        }
                    }
                } else if (msg && msg.type === 'audio_fallback' && msg.url) {
                    // Backend indicates TTS failed/unavailable; play fallback audio + popup
                    try {
                        displayAudioPlayer(msg.url);
                        animateAvatar('speaking');
                        try { showNotification('Audio fallback used due to an error', 'warning'); } catch {}
                    } catch (e) {
                        console.error('❌ Failed to play fallback audio:', e);
                        try { showNotification('Failed to play fallback audio', 'error'); } catch {}
                    }
                } else if (msg && msg.type === 'audio_chunk') {
                    // Collect base64 audio chunks from server and play streamingly
                    if (typeof msg.audio_b64 === 'string') {
                        console.log(`🎵 Streaming audio chunk #${msg.chunk_index} received (${msg.audio_b64.length} chars)`);
                        
                        // Lazy init streaming playback state
                        if (!App.state.ttsAudioContext) {
                            try { 
                                App.state.ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)(); 
                                console.log('🎧 AudioContext initialized for streaming playback');
                            } catch (e) { 
                                console.error('❌ Failed to create AudioContext:', e);
                            }
                        }
                        if (App.state.ttsAudioContext && App.state.ttsAudioContext.state === 'suspended') {
                            try { 
                                App.state.ttsAudioContext.resume(); 
                                console.log('▶️ AudioContext resumed');
                            } catch (e) { 
                                console.error('❌ Failed to resume AudioContext:', e);
                            }
                        }

                        // Reset per-turn state at first chunk (Murf indexes from 1)
                        if (typeof msg.chunk_index === 'number' && msg.chunk_index <= 1) {
                            console.log('🔄 Starting new audio stream - resetting playback state');
                            App.state.ttsWavHeaderPending = true;
                            App.state.ttsPlayheadTime = App.state.ttsAudioContext ? App.state.ttsAudioContext.currentTime : 0;
                            App.state.ttsIsPlaying = false;
                            App.state.ttsPendingChunks = [];
                            App.state.receivedAudioB64 = [];
                        }

                        // Decode base64 WAV chunks. Some providers prepend a 44-byte RIFF header per chunk.
                        function b64ToPCM32(b64, skipHeader) {
                            const binary = atob(b64);
                            // Detect RIFF header in this chunk (robust if header appears on every chunk)
                            const hasRiff = binary.length >= 12 && binary.substr(0, 4) === 'RIFF' && binary.substr(8, 4) === 'WAVE';
                            const headerLen = hasRiff ? 44 : 0;
                            const offset = (skipHeader || hasRiff) ? headerLen : 0;
                            const len = binary.length - offset;
                            if (len <= 0) {
                                console.warn('⚠️ Empty audio chunk after header skip');
                                return null;
                            }
                            console.log(`🔧 Decoding ${len} bytes (${offset ? 'skipped header' : 'no header'})`);
                            const arr = new Uint8Array(len);
                            for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i + offset);
                            const view = new DataView(arr.buffer);
                            const samples = len / 2;
                            const f32 = new Float32Array(samples);
                            for (let i = 0; i < samples; i++) {
                                const s = view.getInt16(i * 2, true);
                                f32[i] = s / 32768;
                            }
                            console.log(`✅ Decoded ${samples} audio samples`);
                            return f32;
                        }

                        // Schedule chunk playback
                        function playPendingChunks() {
                            if (!App.state.ttsAudioContext || !App.state.ttsPendingChunks || !App.state.ttsPendingChunks.length) {
                                console.log('🔇 No more chunks to play - stopping playback');
                                App.state.ttsIsPlaying = false;
                                return;
                            }
                            const chunk = App.state.ttsPendingChunks.shift();
                            if (!chunk || !chunk.length) {
                                console.warn('⚠️ Empty chunk in queue - skipping');
                                App.state.ttsIsPlaying = false;
                                return;
                            }
                            console.log(`🔊 Playing chunk with ${chunk.length} samples`);
                            const ctx = App.state.ttsAudioContext;
                            const buffer = ctx.createBuffer(1, chunk.length, 44100);
                            buffer.copyToChannel(chunk, 0);
                            const src = ctx.createBufferSource();
                            src.buffer = buffer;
                            src.connect(ctx.destination);
                            const now = ctx.currentTime;
                            if (!App.state.ttsPlayheadTime || App.state.ttsPlayheadTime < now) {
                                // Small safety delay; increase on mobile to reduce underruns
                                const safety = /Mobi|Android/i.test(navigator.userAgent) ? 0.15 : 0.08;
                                App.state.ttsPlayheadTime = now + safety;
                                console.log(`⏰ Adjusted playhead time to ${App.state.ttsPlayheadTime.toFixed(3)}s (safety=${safety}s)`);
                            }
                            try { 
                                src.start(App.state.ttsPlayheadTime); 
                                console.log(`▶️ Started playback at ${App.state.ttsPlayheadTime.toFixed(3)}s`);
                            } catch (e) { 
                                console.error('❌ Failed to start audio source:', e);
                            }
                            App.state.ttsPlayheadTime += buffer.duration;
                            console.log(`⏭️ Next playhead time: ${App.state.ttsPlayheadTime.toFixed(3)}s (duration: ${buffer.duration.toFixed(3)}s)`);
                            if (App.state.ttsPendingChunks.length > 0) {
                                // Schedule next chunk slightly later to give decode time on slower devices
                                setTimeout(() => playPendingChunks(), 10);
                            } else {
                                console.log('✅ All chunks played - stream complete');
                                App.state.ttsIsPlaying = false;
                            }
                        }

                        const skipHeader = !!App.state.ttsWavHeaderPending;
                        const f32 = b64ToPCM32(msg.audio_b64, skipHeader);
                        if (skipHeader) {
                            App.state.ttsWavHeaderPending = false;
                            console.log('📋 WAV header processed and skipped');
                        }
                        if (f32 && f32.length) {
                            if (!Array.isArray(App.state.ttsPendingChunks)) App.state.ttsPendingChunks = [];
                            App.state.ttsPendingChunks.push(f32);
                            console.log(`📥 Added chunk to queue (${App.state.ttsPendingChunks.length} chunks pending)`);
                            if (!App.state.ttsIsPlaying) {
                                // If a preview is playing, delay TTS playback until it completes
                                if (App.state.previewIsPlaying) {
                                    console.log('⏸️ Preview in progress - delaying TTS playback');
                                    App.state.ttsIsPlaying = false;
                                } else {
                                    console.log('🎬 Starting streaming playback');
                                    App.state.ttsIsPlaying = true;
                                    playPendingChunks();
                                }
                            }
                        } else {
                            console.warn('⚠️ Failed to decode audio chunk - skipping');
                        }

                        // Keep copy of raw chunks to synthesize a final WAV for the player
                        App.state.receivedAudioB64.push(msg.audio_b64);
                        console.log(`🎵 client received audio_chunk #${msg.chunk_index} (len=${msg.audio_b64.length}) end_of_turn=${msg.end_of_turn}`);

                        if (msg.end_of_turn) {
                            console.log('✅ client audio stream finalized (end_of_turn=true)');
                            console.log(`🎯 Building final WAV from ${App.state.receivedAudioB64.length} chunks`);
                            // Build a final WAV blob and attach to the existing audio container
                            function b64ToBytes(b64) {
                                const bin = atob(b64);
                                const out = new Uint8Array(bin.length);
                                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                                return out;
                            }
                            function wavHeader(dataLen, sampleRate = 44100, channels = 1, bitDepth = 16) {
                                const blockAlign = (channels * bitDepth) / 8;
                                const byteRate = sampleRate * blockAlign;
                                const buf = new ArrayBuffer(44);
                                const v = new DataView(buf);
                                function putStr(o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
                                putStr(0, 'RIFF');
                                v.setUint32(4, 36 + dataLen, true);
                                putStr(8, 'WAVE');
                                putStr(12, 'fmt ');
                                v.setUint32(16, 16, true);
                                v.setUint16(20, 1, true);
                                v.setUint16(22, channels, true);
                                v.setUint32(24, sampleRate, true);
                                v.setUint32(28, byteRate, true);
                                v.setUint16(32, blockAlign, true);
                                v.setUint16(34, bitDepth, true);
                                putStr(36, 'data');
                                v.setUint32(40, dataLen, true);
                                return new Uint8Array(buf);
                            }
                            const chunks = App.state.receivedAudioB64 || [];
                            const pcmParts = [];
                            for (let i = 0; i < chunks.length; i++) {
                                const bytes = b64ToBytes(chunks[i]);
                                pcmParts.push(i === 0 ? bytes.slice(44) : bytes);
                            }
                            const totalLen = pcmParts.reduce((n, a) => n + a.length, 0);
                            console.log(`🔧 Combined PCM data: ${totalLen} bytes`);
                            const pcmAll = new Uint8Array(totalLen);
                            let off = 0;
                            for (const part of pcmParts) { pcmAll.set(part, off); off += part.length; }
                            const header = wavHeader(totalLen);
                            const finalWav = new Uint8Array(header.length + pcmAll.length);
                            finalWav.set(header, 0); finalWav.set(pcmAll, header.length);
                            console.log(`📦 Final WAV created: ${finalWav.length} bytes total`);
                            const url = URL.createObjectURL(new Blob([finalWav], { type: 'audio/wav' }));
                          
                            // Try to find the audio container in the current voice chat tab
                            const container = document.getElementById('echo-audio-container');
                            console.log('🔍 Looking for audio container:', container ? 'FOUND' : 'NOT FOUND');
                            
                            if (container) {
                                console.log('🎵 Injecting final audio player into echo-audio-container');
                                container.innerHTML = `
                                    <div style="text-align: center; padding: var(--spacing-md);">
                                        <p style="color: var(--text-muted); margin-bottom: var(--spacing-sm);">
                                            <i class="fas fa-volume-up"></i> AI Response Audio
                                        </p>
                                          <audio controls autoplay style="width: 100%; max-width: 400px; border-radius: 8px;">
                                            <source src="${url}" type="audio/wav">
                                            Your browser does not support the audio element.
                                        </audio>
                                    </div>
                                `;
                                console.log('✅ Audio player successfully injected');
                                // If preview was playing, we will queue this TTS audio until preview ends
                                try { App.state.ttsQueuedUrl = url; } catch {}
                            } else {
                                console.error('❌ echo-audio-container not found - cannot display final audio player');
                                // Fallback: try to add to chat history as a message
                                console.log('🔄 Attempting fallback: adding audio to chat history');
                                try {
                                    const chatHistory = document.getElementById('chat-history');
                                    if (chatHistory) {
                                        const audioMessage = document.createElement('div');
                                        audioMessage.className = 'message assistant-message';
                                        audioMessage.innerHTML = `
                                            <div class="message-content">
                                                <audio controls style="width: 100%; max-width: 300px;">
                                                    <source src="${url}" type="audio/wav">
                                                </audio>
                                            </div>
                                        `;
                                        chatHistory.appendChild(audioMessage);
                                        chatHistory.scrollTop = chatHistory.scrollHeight;
                                        console.log('✅ Audio added to chat history as fallback');
                                    }
                                } catch (e) {
                                    console.error('❌ Fallback also failed:', e);
                                }
                            }
                        }
                    }
                }
            } catch (_) {
                // ignore non-JSON frames
            }
        };
        App.state.ws.onerror = (ev) => {
            const statusEl = document.getElementById('statusText');
            if (statusEl) statusEl.textContent = 'Connection error';
            try { showNotification('Voice connection error', 'error'); } catch {}
        };
        App.state.ws.onclose = () => {
            const statusEl = document.getElementById('statusText');
            if (statusEl) statusEl.textContent = 'Ready to record';
            try { showNotification('Voice session ended', 'info', 2500); } catch {}
        };

        // Set up PCM16 (16kHz mono) streaming via Web Audio API
        App.state.audioContext = App.state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
        // Resume context if needed (required by some browsers)
        if (App.state.audioContext.state === 'suspended') {
            try { await App.state.audioContext.resume(); } catch (e) {}
        }

        App.state.sourceNode = App.state.audioContext.createMediaStreamSource(stream);

        // Prefer AudioWorkletNode (no deprecation warnings). Fallback to ScriptProcessorNode.
        try {
            if (App.state.audioContext.audioWorklet) {
                await App.state.audioContext.audioWorklet.addModule('/static/audio-worklet-processor.js');
                App.state.workletNode = new AudioWorkletNode(App.state.audioContext, 'pcm-processor');
                App.state.workletNode.port.onmessage = (ev) => {
                    const float32 = ev.data; // Float32Array mono
                    const sourceRate = App.state.audioContext && App.state.audioContext.sampleRate;
                    if (!sourceRate || !App.state.ws || App.state.ws.readyState !== WebSocket.OPEN) return;
                    const int16 = downsampleTo16kPCM(float32, sourceRate);
                    if (int16 && int16.length) {
                        // Accumulate and send in >=50ms chunks (800 samples @16k)
                        if (!Array.isArray(App.state.pcmBuffer)) App.state.pcmBuffer = [];
                        for (let i = 0; i < int16.length; i++) App.state.pcmBuffer.push(int16[i]);
                        const minSamples = App.state.pcmMinSamples || 800;
                        while (App.state.pcmBuffer.length >= minSamples) {
                            const chunk = App.state.pcmBuffer.splice(0, minSamples);
                            try { App.state.ws.send(new Int16Array(chunk).buffer); } catch {}
                        }
                    }
                };
                App.state.sourceNode.connect(App.state.workletNode);
            } else {
                throw new Error('AudioWorklet not supported');
            }
        } catch (_) {
            // Fallback: ScriptProcessorNode
            App.state.processorNode = App.state.audioContext.createScriptProcessor(4096, 1, 1);
            App.state.processorNode.onaudioprocess = (e) => {
                if (!e || !e.inputBuffer) return;
                const sourceRate = e.inputBuffer.sampleRate || (App.state.audioContext && App.state.audioContext.sampleRate);
                if (!sourceRate || !App.state.ws || App.state.ws.readyState !== WebSocket.OPEN) return;
                const input = e.inputBuffer.getChannelData(0);
                const int16 = downsampleTo16kPCM(input, sourceRate);
                if (int16 && int16.length) {
                    // Accumulate and send in >=50ms chunks (800 samples @16k)
                    if (!Array.isArray(App.state.pcmBuffer)) App.state.pcmBuffer = [];
                    for (let i = 0; i < int16.length; i++) App.state.pcmBuffer.push(int16[i]);
                    const minSamples = App.state.pcmMinSamples || 800;
                    while (App.state.pcmBuffer.length >= minSamples) {
                        const chunk = App.state.pcmBuffer.splice(0, minSamples);
                        try { App.state.ws.send(new Int16Array(chunk).buffer); } catch {}
                    }
                }
            };
            App.state.sourceNode.connect(App.state.processorNode);
            try { App.state.processorNode.connect(App.state.audioContext.destination); } catch {}
        }

        // Helper: downsample Float32 mono to 16kHz Int16 PCM
        function downsampleTo16kPCM(buffer, sampleRate) {
            const targetRate = 16000;
            if (sampleRate === targetRate) {
                const result = new Int16Array(buffer.length);
                for (let i = 0; i < buffer.length; i++) {
                    let s = Math.max(-1, Math.min(1, buffer[i]));
                    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                return result;
            }
            const ratio = sampleRate / targetRate;
            const newLength = Math.round(buffer.length / ratio);
            const result = new Int16Array(newLength);
            let offsetResult = 0;
            let offsetBuffer = 0;
            while (offsetResult < newLength) {
                const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
                let sum = 0, count = 0;
                for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                    sum += buffer[i];
                    count++;
                }
                const sample = count ? (sum / count) : 0;
                let s = Math.max(-1, Math.min(1, sample));
                result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                offsetResult++;
                offsetBuffer = nextOffsetBuffer;
            }
            return result;
        }
        
        // Start recorder with timeslice for periodic dataavailable events
        App.state.mediaRecorder.start(250);
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

        // Teardown audio nodes safely
        try {
            App.state.pcmBuffer = [];
            if (App.state.workletNode) {
                try { App.state.workletNode.port.onmessage = null; } catch {}
                try { App.state.workletNode.disconnect(); } catch {}
            }
            if (App.state.processorNode) {
                try { App.state.processorNode.disconnect(); } catch {}
                App.state.processorNode.onaudioprocess = null;
            }
            if (App.state.sourceNode) {
                try { App.state.sourceNode.disconnect(); } catch {}
            }
        } catch (e) {}

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
    avatar.textContent = role === 'user' ? '🍎' : '⚖️';
    
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
        // Add user message to chat history with dedup guard (text-only path)
        const now = Date.now();
        const last = App.state.lastChat.user;
        if (!(last.text === message && (now - last.at) < 3000)) {
            addToChatHistory('user', message);
            App.state.lastChat.user = { text: message, at: now };
        }
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
    avatar.textContent = role === 'user' ? '🍎' : '⚖️';
    
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
    avatar.textContent = '⚖️';
    
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
                <p>Start a conversation with Light Yagami!</p>
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
    
    // Reuse existing AudioContext or create a new one if it doesn't exist.
    // This prevents conflicts and is more efficient than creating a new context every time.
    if (!App.state.audioContext || App.state.audioContext.state === 'closed') {
        App.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

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
        const id = App.state.sessionId;
        const shortId = id && id.length > 6 ? id.slice(0, 6) : (id || 'unknown');
        shortSessionElement.textContent = shortId;
    }
    
    if (messageCountElement) {
        messageCountElement.textContent = String(App.state.messageCount || 0);
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
        backdrop-filter: none;
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
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Add CSS for notifications
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    /* Notification styles - no animations */
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

console.log('✅ KIRA script loaded successfully!');
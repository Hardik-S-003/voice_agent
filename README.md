# Voice Agent Challenge

A minimalist AI voice assistant with intelligent search capabilities, real-time voice interaction, and modern dark purple neon UI design.

## 🌟 Features 

- **Real-time Voice Interaction**: Natural speech conversation with AI
- **Intelligent Web Search**: Powered by SerpApi for current information  
- **Text Chat Interface**: Type messages when voice input isn't preferred
- **Session Management**: Persistent conversation history with SQLite
- **Progressive Web App**: Full PWA support with offline capabilities
- **Dark Purple Neon Theme**: Clean, minimalistic modern design
- **Advanced Audio Processing**: High-quality voice recognition and synthesis

## 🛠️ Tech Stack

**Frontend:**
- HTML5 with semantic structure
- Vanilla JavaScript (ES6+) 
- CSS3 with custom properties and animations
- Web Audio API for voice processing
- Service Worker for PWA features

**Backend:**
- Python 3.12+ with FastAPI framework
- AssemblyAI for Speech-to-Text conversion
- Google Gemini 2.5-Flash for AI responses
- MurfAI for Text-to-Speech synthesis
- SerpApi for real-time web search
- SQLite with SQLAlchemy for persistence

## 🚀 Getting Started

### Prerequisites

```bash
# Clone the repository  
git clone https://github.com/Hardik-S-003/voice_agent.git
cd voice_agent/voice_agent_challenge
```

### Environment Setup

Create a `.env` file in the `server/` directory:

```env
ASSEMBLYAI_API_KEY=your_assemblyai_key
GEMINI_API_KEY=your_gemini_key
MURF_API_KEY=your_murf_key
SERPAPI_KEY=your_serpapi_key
```

### Installation & Running

```bash
# Install Python dependencies
cd server
pip install -r requirements.txt

# Start the server
python main.py

# The application will be available at:
# http://localhost:8000
```

## 📁 Project Structure

```
voice_agent_challenge/
├── client/                     # 🎨 Frontend Files
│   ├── index.html             # Main HTML page
│   ├── script.js              # JavaScript logic & UI
│   ├── audio-worklet-processor.js  # Audio processing
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker
│   ├── icon-192.png           # PWA icons
│   ├── icon-512.png
│   └── icon-512-maskable.png
└── server/                     # 🖥️ Backend Files
    ├── main.py                # FastAPI server
    ├── requirements.txt       # Python dependencies  
    ├── .env                   # Environment variables
    ├── ava_data.db           # SQLite database
    └── fallback.mp3          # TTS fallback audio
```

## 🔗 API Endpoints

- `GET /`: Main application interface
- `POST /llm/query`: Voice conversation processing
- `POST /llm/text-query`: Text chat processing
- `POST /tts/echo/`: Echo bot functionality  
- `POST /generate-audio/`: Text-to-speech conversion
- `POST /chat/clear`: Clear conversation history
- `GET /sw.js`: Service worker for PWA
- `GET /sessions`: Session management
- `POST /config/api-keys`: API key configuration

## ✨ Key Features in Detail

### 🎤 Voice Processing
- Real-time voice recording with WebSocket streaming
- Advanced audio visualization during recording  
- High-accuracy speech-to-text with AssemblyAI
- Natural text-to-speech responses with MurfAI

### 🧠 AI Integration
- Google Gemini 2.5-Flash for intelligent responses
- SerpApi integration for real-time web search
- Function calling for dynamic information retrieval
- Context-aware conversation handling

### 🎨 User Interface
- Minimalistic dark purple neon theme
- Fully responsive design for all devices
- Progressive Web App (PWA) capabilities
- Clean chat interface with persistent history

### 💾 Session Management
- Unique session IDs for conversation tracking
- SQLite database for persistent storage
- Message history preservation across sessions
- Clear conversation functionality

## 🧪 Testing the Application

1. **Start the server**: `cd server && python main.py`
2. **Open browser**: Navigate to `http://localhost:8000`
3. **Test voice**: Click the microphone and speak
4. **Test text**: Type a message in the chat input
5. **Test search**: Ask questions like "who is sunitha williams"

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🔧 Development Notes

- **Clean Architecture**: Separation of client and server code
- **Modern Web Standards**: ES6+, CSS Grid, Flexbox
- **Real-time Communication**: WebSocket support
- **PWA Ready**: Offline functionality and installable
- **Production Ready**: Error handling and fallbacks

## 🙏 Acknowledgments

- **AssemblyAI** for advanced speech-to-text capabilities
- **Google Gemini** for powerful AI processing  
- **MurfAI** for high-quality text-to-speech synthesis
- **SerpApi** for real-time web search integration
- **FastAPI** for the robust and fast backend framework

---

*Built with ❤️ for seamless AI voice interaction*

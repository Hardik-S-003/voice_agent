# 🎙 AI Voice Agent 

An end-to-end **voice-driven conversational AI assistant** built as part of the **Murf AI 30 Days of AI Voice Agents Challenge**.  
The assistant can **listen**, **understand**, **think**, and **speak back** — all in a smooth, hands-free conversation loop.

---

## 📖 Table of Contents
- [About](#about)
- [Technologies Used](#technologies-used)
- [Architecture](#architecture)
- [Setup Instructions](#setup-instructions)

---

## 📌 About

This project started as a simple **Text-to-Speech** demo and grew into a **full voice-to-voice AI chat agent** over the course of multiple daily tasks.

It allows a user to:
1. Speak into their microphone
2. Get their voice transcribed to text
3. Send it to a Large Language Model (LLM) for intelligent responses
4. Hear the LLM’s response back in a natural Murf AI voice
5. Continue the conversation without pressing any extra buttons

By Day 12, the project features a **modern, chat-style UI** inspired by popular AI assistants (ChatGPT, Gemini, Grok, etc.).

---

## 🛠 Technologies Used

**Frontend**
- HTML5, CSS3, JavaScript
- MediaRecorder API for microphone input
- Modern chat UI with animated mic button

**Backend**
- Python 3.x
- Flask for API server
- FFmpeg (audio format conversion)
- In-memory session storage for chat history

**APIs & AI Models**
- [Murf AI API](https://murf.ai/) – Text-to-Speech
- [AssemblyAI API](https://www.assemblyai.com/) – Speech-to-Text
- [Google Gemini API](https://ai.google/) – Large Language Model (Gemini 1.5 Flash)

**Other**
- `python-dotenv` for environment variable management
- `werkzeug` for secure file handling
- Gitpod / GitHub for development and version control

---

## 🏗 Architecture

The AI Voice Agent is built using a **client–server model** with the following flow:  

1. **User Interaction (Frontend – Browser)**  
   - The user taps the **mic button** to start recording.  
   - The **MediaRecorder API** captures audio in **WebM/Opus** format.  
   - The recorded audio is sent to the Flask backend via `POST /agent/chat/{session_id}`.  

2. **Audio Processing (Backend – Flask)**  
   - Audio is saved temporarily and converted from **WebM to WAV (16kHz mono)** using **FFmpeg**.  
   - The converted audio is sent to **AssemblyAI** for **Speech-to-Text (STT)** transcription.  

3. **Context Management (Backend)**  
   - Transcribed text is appended to the **in-memory session chat history** keyed by `session_id`.  
   - The full conversation history is sent to the **Google Gemini LLM** for a context-aware response.  

4. **Speech Synthesis (Backend)**  
   - The LLM response text is sent to the **Murf AI TTS** API to generate a natural-sounding voice reply.  
   - The generated audio file URL is sent back to the frontend along with the transcript and LLM text.  

5. **Response Playback (Frontend)**  
   - The browser plays the AI’s voice response.  
   - Once playback finishes, recording automatically starts for the next user message, enabling **hands-free conversation**.  

**Key Components:**
- **Frontend:** HTML, CSS, JavaScript, MediaRecorder API  
- **Backend:** Flask (Python), FFmpeg  
- **APIs:** Murf AI (TTS), AssemblyAI (STT), Google Gemini (LLM)  
- **Data Storage:** In-memory Python dictionary for session-based chat history

---

## 🚀 Setup Instructions

1️⃣ Clone the Repository

2️⃣ Create a Virtual Environment
- python -m venv venv
- source venv/bin/activate  
- venv\Scripts\activate  

3️⃣ Install Dependencies
- pip install -r requirements.txt

4️⃣ Install FFmpeg
- Make sure ffmpeg is installed and accessible from your system PATH:
- ffmpeg -version
- If not, install it from FFmpeg.org.

5️⃣ Set Environment Variables
- Create a .env file in the project root:
- API_KEY=your_murf_api_key
- AI_API=your_assemblyai_api_key
- GEMINI_API_KEY=your_google_gemini_api_key

6️⃣ Run the Flask Server
- cd server
- python server.py
- The server will start on http://localhost:5000.

7️⃣ Open the App
- In your browser, go to:
- http://localhost:5000


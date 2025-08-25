import os
import requests
import uuid
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import assemblyai as aai
import google.generativeai as genai

class GenerateAudioRequest(BaseModel):
    text: str

class TextQueryRequest(BaseModel):
    text: str
    session_id: str

class ClearChatRequest(BaseModel):
    session_id: str

# Load the .env file
load_dotenv(".env")
MURF_API_KEY = os.getenv("MURF_API_KEY")
if not MURF_API_KEY:
    print("WARNING: MURF_API_KEY not found in .env file. The /generate-audio endpoint will not work.")

# Load and configure your AssemblyAI API key
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not ASSEMBLYAI_API_KEY:
    print("WARNING: ASSEMBLYAI_API_KEY not found in .env file. The /transcribe endpoint will not work.")
else:
    aai.settings.api_key = ASSEMBLYAI_API_KEY

# Load and configure your Gemini API key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not found in .env file. The /llm/query endpoint will not work.")
else:
    genai.configure(api_key=GEMINI_API_KEY)

# Create FastAPI app
app = FastAPI()

# In-memory storage for chat sessions
chat_sessions = {}

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Setup ---
app.mount("/static", StaticFiles(directory="../client/static"), name="static")
templates = Jinja2Templates(directory="../client")

# --- Helper Function ---
def serve_debug_html(file_name: str):
    """Safely reads and serves an HTML file, handling FileNotFoundError."""
    try:
        with open(file_name, "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(
            content=f"<h1>Error: Not Found</h1><p>Debug file '{file_name}' not found.</p>",
            status_code=404
        )

# --- Endpoints ---
# Root endpoint to serve the UI
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/debug", response_class=HTMLResponse)
async def debug_page():
    return serve_debug_html("debug_audio.html")

@app.get("/debug-echo", response_class=HTMLResponse)
async def debug_echo_page():
    return serve_debug_html("debug_echo.html")

@app.get("/simple-echo", response_class=HTMLResponse)
async def simple_echo_page():
    return serve_debug_html("simple_echo.html")

# POST endpoint to generate audio from text
@app.post("/generate-audio/")
async def generate_audio(request: Request, payload: GenerateAudioRequest):
    text = payload.text
    if not text:
        return JSONResponse(content={"error": "Text is required"}, status_code=400)

    if not MURF_API_KEY:
        fallback_url = f"{request.base_url}static/fallback.mp3"
        return JSONResponse(content={
            "audioFile": fallback_url,
            "error": "Server is not configured with a Murf AI API key.",
            "fallback": True
        })

    url = "https://api.murf.ai/v1/speech/generate"
    headers = {
        "api-key": MURF_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "text": text,
        "voiceId": "en-IN-alia",
        "format": "MP3"
    }

    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        murf_data = response.json()
        audio_url = murf_data.get("audioFile")

        if not audio_url:
            fallback_url = f"{request.base_url}static/fallback.mp3"
            return JSONResponse(content={
                "audioFile": fallback_url,
                "error": "Murf API did not return an audio file.",
                "fallback": True
            })

        return murf_data
    except requests.exceptions.RequestException as e:
        fallback_url = f"{request.base_url}static/fallback.mp3"
        return JSONResponse(content={
            "audioFile": fallback_url,
            "error": f"Murf API error: {str(e)}",
            "fallback": True
        })
    except Exception as e:
        fallback_url = f"{request.base_url}static/fallback.mp3"
        return JSONResponse(content={
            "audioFile": fallback_url,
            "error": f"Unexpected error: {str(e)}",
            "fallback": True
        })

@app.post("/tts/echo/")
async def tts_echo(request: Request, file: UploadFile = File(...)):
    """
    This endpoint transcribes the user's audio, then uses that text to
    generate a new audio file with a Murf voice.
    """
    fallback_url = f"{request.base_url}static/fallback.mp3"
    
    if not ASSEMBLYAI_API_KEY or not MURF_API_KEY:
        return JSONResponse(content={
            "audioFile": fallback_url,
            "transcription": "I'm having trouble connecting right now",
            "error": "Server is missing required API keys for this feature.",
            "fallback": True
        })

    try:
        # Reads the audio data from the uploaded file
        audio_data = await file.read()
        
        # Transcribe the audio using AssemblyAI
        print("🎙️  Transcribing audio with AssemblyAI...")
        try:
            transcriber = aai.Transcriber()
            transcript = transcriber.transcribe(audio_data)

            if transcript.error:
                print(f"AssemblyAI Error: {transcript.error}")
                return JSONResponse(content={
                    "audioFile": fallback_url,
                    "transcription": "I'm having trouble connecting right now",
                    "error": f"AssemblyAI Error: {transcript.error}",
                    "fallback": True
                })

            transcribed_text = transcript.text
            if not transcribed_text:
                return JSONResponse(content={
                    "audioFile": fallback_url,
                    "transcription": "I'm having trouble connecting right now",
                    "error": "Could not find any words to transcribe in the audio.",
                    "fallback": True
                })
                
        except Exception as e:
            print(f"AssemblyAI Exception: {e}")
            return JSONResponse(content={
                "audioFile": fallback_url,
                "transcription": "I'm having trouble connecting right now",
                "error": f"Speech recognition error: {str(e)}",
                "fallback": True
            })
            
        print(f"Transcription successful: '{transcribed_text}'")

        # Step 3: Send the transcribed text to Murf to generate a new voice
        print(f"Sending text to Murf to generate voice...")
        try:
            murf_url = "https://api.murf.ai/v1/speech/generate"
            headers = {"api-key": MURF_API_KEY, "Content-Type": "application/json"}
            payload = {"text": transcribed_text, "voiceId": "en-IN-priya", "format": "MP3"}
            
            response = requests.post(murf_url, json=payload, headers=headers)
            response.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)

            murf_data = response.json()
            audio_url = murf_data.get("audioFile")

            if not audio_url:
                return JSONResponse(content={
                    "audioFile": fallback_url,
                    "transcription": transcribed_text,
                    "error": "Murf API did not return an audio file.",
                    "fallback": True
                })

            print(f"🎧  Murf audio generated successfully.")
            
            # Step 4: Return both the transcription and the URL of the new Murf audio
            return JSONResponse(content={
                "audioFile": audio_url,
                "transcription": transcribed_text,
                "audioLengthInSeconds": murf_data.get("audioLengthInSeconds"),
                "consumedCharacterCount": murf_data.get("consumedCharacterCount"),
                "remainingCharacterCount": murf_data.get("remainingCharacterCount")
            })

        except requests.exceptions.RequestException as e:
            # Handle Murf API errors
            print(f"Murf API Request Error: {e}")
            return JSONResponse(content={
                "audioFile": fallback_url,
                "transcription": transcribed_text,
                "error": f"Voice generation error: {str(e)}",
                "fallback": True
            })

    except Exception as e:
        # Handle other unexpected errors
        print(f"An unexpected error occurred in /tts/echo/: {e}")
        return JSONResponse(content={
            "audioFile": fallback_url,
            "transcription": "I'm having trouble connecting right now",
            "error": f"Unexpected error: {str(e)}",
            "fallback": True
        })

# Simple LLM query endpoint for text-only interaction
@app.post("/llm/query")
async def llm_query(request: Request, file: UploadFile = File(...), session_id: str = Form(...)):
    """
    Receives audio, transcribes it, sends text to Gemini LLM with history,
    converts response to Murf audio, returns both text + audio.
    """

    fallback_url = f"{request.base_url}static/fallback.mp3"
    
    if not (ASSEMBLYAI_API_KEY and GEMINI_API_KEY and MURF_API_KEY):
        return JSONResponse(content={
            "userTranscription": "I'm having trouble connecting right now",
            "llmResponse": "I'm having trouble connecting right now",
            "audioFile": fallback_url,
            "error": "Missing API keys.",
            "fallback": True
        })

    try:
        # 1. Read uploaded audio
        audio_data = await file.read()

        # 2. Transcribe with AssemblyAI
        try:
            transcriber = aai.Transcriber()
            transcript = transcriber.transcribe(audio_data)
            if transcript.error:
                return JSONResponse(content={
                    "userTranscription": "I'm having trouble connecting right now",
                    "llmResponse": "I'm having trouble connecting right now",
                    "audioFile": fallback_url,
                    "error": f"AssemblyAI Error: {transcript.error}",
                    "fallback": True
                })
            user_text = transcript.text
            if not user_text:
                return JSONResponse(content={
                    "userTranscription": "I'm having trouble connecting right now",
                    "llmResponse": "I'm having trouble connecting right now",
                    "audioFile": fallback_url,
                    "error": "No speech detected.",
                    "fallback": True
                })
        except Exception as e:
            return JSONResponse(content={
                "userTranscription": "I'm having trouble connecting right now",
                "llmResponse": "I'm having trouble connecting right now",
                "audioFile": fallback_url,
                "error": f"Speech recognition error: {str(e)}",
                "fallback": True
            })

        print(f"User: {user_text}")

        # 3. Send to Gemini with history
        try:
            # Get history for the session
            history = chat_sessions.get(session_id, [])
            
            model = genai.GenerativeModel('gemini-2.5-flash')
            # Start a chat with the existing history
            chat = model.start_chat(history=history)
            
            # Send the new message
            llm_response = chat.send_message(user_text)
            ai_text = llm_response.text

            # Update the session history
            chat_sessions[session_id] = chat.history
            if not ai_text:
                return JSONResponse(content={
                    "userTranscription": user_text,
                    "llmResponse": "I'm having trouble connecting right now",
                    "audioFile": fallback_url,
                    "error": "Gemini returned no text.",
                    "fallback": True
                })
        except Exception as e:
            return JSONResponse(content={
                "userTranscription": user_text,
                "llmResponse": "I'm having trouble connecting right now",
                "audioFile": fallback_url,
                "error": f"AI processing error: {str(e)}",
                "fallback": True
            })

        print(f"LLM: {ai_text}")

        # 4. Send to Murf
        try:
            murf_url = "https://api.murf.ai/v1/speech/generate"
            headers = {"api-key": MURF_API_KEY, "Content-Type": "application/json"}
            payload = {"text": ai_text, "voiceId": "en-IN-priya", "format": "MP3"}
            murf_resp = requests.post(murf_url, json=payload, headers=headers)
            murf_resp.raise_for_status()
            murf_data = murf_resp.json()
            audio_url = murf_data.get("audioFile")

            if not audio_url:
                return JSONResponse(content={
                    "userTranscription": user_text,
                    "llmResponse": ai_text,
                    "audioFile": fallback_url,
                    "error": "Murf API did not return an audio file.",
                    "fallback": True
                })

            return JSONResponse(content={
                "userTranscription": user_text,
                "llmResponse": ai_text,
                "audioFile": audio_url,
                "audioLengthInSeconds": murf_data.get("audioLengthInSeconds"),
                "consumedCharacterCount": murf_data.get("consumedCharacterCount"),
                "remainingCharacterCount": murf_data.get("remainingCharacterCount")
            })

        except requests.exceptions.RequestException as e:
            return JSONResponse(content={
                "userTranscription": user_text,
                "llmResponse": ai_text,
                "audioFile": fallback_url,
                "error": f"Voice generation error: {str(e)}",
                "fallback": True
            })

    except Exception as e:
        return JSONResponse(content={
            "userTranscription": "I'm having trouble connecting right now",
            "llmResponse": "I'm having trouble connecting right now",
            "audioFile": fallback_url,
            "error": f"Unexpected error: {str(e)}",
            "fallback": True
        })

# New endpoint to clear chat history for a session
@app.post("/chat/clear")
async def clear_chat_history(payload: ClearChatRequest):
    """Clears the chat history for a given session."""
    session_id = payload.session_id

    if session_id in chat_sessions:
        del chat_sessions[session_id]
        print(f"Cleared chat history for session: {session_id}")
        return JSONResponse(content={"message": "Chat history cleared successfully."})
    else:
        print(f"Attempted to clear non-existent session: {session_id}")
        return JSONResponse(content={"message": "No history found for this session."}, status_code=404)

# Text-only LLM query endpoint for the AI Chat Section
@app.post("/llm/text-query")
async def llm_text_query(payload: TextQueryRequest):
    """Handles text-to-text LLM queries with session history."""
    user_text = payload.text
    session_id = payload.session_id

    print(f"User_session: {session_id[:8]}...): {user_text}")

    try:
        history = chat_sessions.get(session_id, [])
        model = genai.GenerativeModel('gemini-2.5-flash')
        chat = model.start_chat(history=history)
        llm_response = chat.send_message(user_text)
        ai_text = llm_response.text
        
        chat_sessions[session_id] = chat.history

        if not ai_text:
            raise HTTPException(status_code=500, detail="Gemini returned no text.")

        print(f"LLM: {ai_text}")
        return JSONResponse(content={"llmResponse": ai_text})
        
    except Exception as e:
        print(f"Gemini API Error in text query: {e}")
        raise HTTPException(status_code=500, detail=f"AI processing error: {str(e)}")

# Serve service worker at /sw.js
from fastapi.responses import FileResponse

@app.get("/sw.js")
async def service_worker():
    return FileResponse("sw.js", media_type="application/javascript")

# --- Server Startup ---
if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting Echo AI Voice Agent")
    print("📡 Server will be available at: https://localhost:8000")
    print("🎯 API endpoints:")
    print("   • GET  /                    - Main interface")
    print("   • POST /llm/query          - Voice conversation")
    print("   • POST /llm/text-query     - Text chat")
    print("   • POST /tts/echo/          - Echo bot")
    print("   • POST /generate-audio/    - Text to speech")
    print("   • POST /chat/clear         - Clear chat history")
    print("   • GET  /sw.js              - Service worker")
    print("Server Started Successfully")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
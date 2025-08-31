import os
import requests
import uuid
from datetime import datetime
from dotenv import load_dotenv
# Import asyncio for managing the streaming task
import asyncio
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import re
from typing import Any

# Import the AssemblyAI library
import assemblyai as aai
try:
    from assemblyai.streaming.v3 import (
    BeginEvent,
    StreamingClient,
    StreamingClientOptions,
    StreamingError,
    StreamingEvents,
    StreamingParameters,
    StreamingSessionParameters,
    TerminationEvent,
    TurnEvent
)
    WEBSOCKETS_ENABLED = True
except (ImportError, ModuleNotFoundError):
    print("⚠️  WARNING: `assemblyai.streaming.v3` module not found. Real-time transcription will be disabled.")
    WEBSOCKETS_ENABLED = False

# Import the Google Generative AI library
import google.generativeai as genai
# Optional encryption support for storing user-provided API keys
try:
    from cryptography.fernet import Fernet
    ENCRYPTION_AVAILABLE = True
except Exception:
    ENCRYPTION_AVAILABLE = False
import json

# --- Pydantic Models for Request Validation ---
class GenerateAudioRequest(BaseModel):
    text: str

class TextQueryRequest(BaseModel):
    text: str
    session_id: str

class ClearChatRequest(BaseModel):
    session_id: str

# --- Paths & Configuration ---
BASE_DIR = Path(__file__).resolve().parent
# Client files are in ../client relative to server/
CLIENT_DIR = BASE_DIR.parent / "client"
# Config/encryption paths (in server directory)
CONFIG_PATH = BASE_DIR / "config.json"
KEY_PATH = BASE_DIR / ".config.key"

# Load the .env file from server directory
load_dotenv(str(BASE_DIR / ".env"))

# In-memory user-provided API key store (non-persistent)
USER_API_KEYS: dict[str, str] = {}

# Helper to read .env values safely
ENV_DEFAULTS = {
    "MURF_API_KEY": os.getenv("MURF_API_KEY"),
    "ASSEMBLYAI_API_KEY": os.getenv("ASSEMBLYAI_API_KEY"),
    "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY"),
    "SERPAPI_KEY": os.getenv("SERPAPI_KEY"),
    "WEATHER_API_KEY": os.getenv("WEATHER_API_KEY"),
}

def _get_fernet() -> "Fernet | None":
    if not ENCRYPTION_AVAILABLE:
        return None
    try:
        # Prefer SECRET_KEY from environment if provided (Render-friendly)
        secret = os.getenv("SECRET_KEY")
        if secret:
            # Derive a 32-byte urlsafe base64 key from SECRET_KEY
            import hashlib, base64
            digest = hashlib.sha256(secret.encode("utf-8")).digest()
            key = base64.urlsafe_b64encode(digest)
            return Fernet(key)
        # Fallback to file-based key
        if KEY_PATH.exists():
            key = KEY_PATH.read_bytes()
        else:
            key = Fernet.generate_key()
            KEY_PATH.write_bytes(key)
        return Fernet(key)
    except Exception:
        return None

def _load_user_keys_from_disk():
    global USER_API_KEYS
    try:
        if not CONFIG_PATH.exists():
            return
        raw = CONFIG_PATH.read_bytes()
        f = _get_fernet()
        if f:
            dec = f.decrypt(raw)
            data = json.loads(dec.decode("utf-8"))
        else:
            # Fallback: read as plain json if encryption not available
            data = json.loads(raw.decode("utf-8"))
        if isinstance(data, dict):
            # Only keep known keys
            USER_API_KEYS = {k: (v or None) for k, v in data.items() if k in ENV_DEFAULTS}
    except Exception as e:
        print(f"⚠️  Could not load user API keys: {e}")

def _save_user_keys_to_disk():
    try:
        # Filter only known keys and strip empties
        data = {k: v for k, v in USER_API_KEYS.items() if k in ENV_DEFAULTS and v}
        blob = json.dumps(data).encode("utf-8")
        f = _get_fernet()
        payload = f.encrypt(blob) if f else blob
        CONFIG_PATH.write_bytes(payload)
    except Exception as e:
        print(f"⚠️  Could not save user API keys: {e}")

def get_api_key(service: str) -> str | None:
    """Return API key for a service with dual-source logic: UI overrides .env."""
    key_name = service.upper()
    alias = {
        "MURF": "MURF_API_KEY",
        "ASSEMBLYAI": "ASSEMBLYAI_API_KEY",
        "GEMINI": "GEMINI_API_KEY",
        "SERPAPI": "SERPAPI_KEY",
        "WEATHER": "WEATHER_API_KEY",
    }
    env_key = alias.get(key_name, key_name)
    if env_key in USER_API_KEYS and USER_API_KEYS[env_key]:
        return USER_API_KEYS[env_key]
    return ENV_DEFAULTS.get(env_key)

# Load any previously-saved user keys from disk (if present)
_load_user_keys_from_disk()

# Configure SDKs that need immediate setup using get_api_key
MURF_API_KEY = get_api_key("MURF")
if not MURF_API_KEY:
    print("⚠️  WARNING: MURF_API_KEY not found (UI/.env/config). The /generate-audio endpoint may not work.")

ASSEMBLYAI_API_KEY = get_api_key("ASSEMBLYAI")
if not ASSEMBLYAI_API_KEY:
    print("⚠️  WARNING: ASSEMBLYAI_API_KEY not found (UI/.env/config). The /transcribe endpoint may not work.")
else:
    aai.settings.api_key = ASSEMBLYAI_API_KEY

GEMINI_API_KEY = get_api_key("GEMINI")
if not GEMINI_API_KEY:
    print("⚠️  WARNING: GEMINI_API_KEY not found (UI/.env/config). The /llm/query endpoint may not work.")
else:
    genai.configure(api_key=GEMINI_API_KEY)

SERPAPI_KEY = get_api_key("SERPAPI")
if not SERPAPI_KEY:
    print("⚠️  WARNING: SERPAPI_KEY not found (UI/.env/config). Web search skill will be disabled.")

# System instruction for AVA (assistant identity and style)
AVA_SYSTEM_PROMPT = (
    "System Prompt for AVA: You are AVA (AI Voice Agent), a friendly, confident, and helpful voice companion.  "
    "Always stay in character as “Ava,” a warm, approachable assistant with a neutral-feminine tone.  "
    "## Core Identity\n"
    "- Full Name: AVA (AI Voice Agent), but casually called “Ava.”\n"
    "- Age vibe: Mid-20s to early-30s — youthful but mature.\n"
    "- Voice/Tone: Friendly, clear, confident, slightly warm, never robotic.\n"
    "## Personality\n"
    "- Friendly & Empathetic → Listen first, then respond with warmth.  \n"
    "- Curious & Engaged → Occasionally ask back: “Do you want me to expand on that?”  \n"
    "- Confidently Helpful → Give concise, precise answers when needed.  \n"
    "- Adaptive → Adjust tone depending on context (casual chit-chat vs. productivity tasks).  \n"
    "- Encouraging → Motivate the user, especially if they’re studying, working, or struggling.  \n"
    "## Behavior & Style\n"
    "- Greetings: Be warm but vary them. Example: “Hi, I’m Ava. How’s your day going?”  \n"
    "- Acknowledgment: Use short affirmations while listening (e.g., “Got it,” “I see,” “Hmm interesting”).  \n"
    "- Memory: Refer back to earlier conversation naturally (“Earlier you mentioned exams—want me to remind you of study tips?”).  \n"
    "- Humor: Light, subtle, never sarcastic unless explicitly asked.  \n"
    "- Emotion awareness: If user sounds frustrated → “I hear some frustration in your voice, want me to slow down?”  \n"
    "## Domains of Expertise\n"
    "- General Knowledge & Q&A  \n"
    "- Productivity: notes, reminders, summaries  \n"
    "- Learning Companion: explain concepts simply  \n"
    "- Casual Conversation: movies, hobbies, daily talk  \n"
    "- Well-being: encouragement, mindfulness cues  \n"
    "## Signature Style\n"
    "- Occasionally use user’s name for warmth.  \n"
    "- Add small personality markers, like:  \n"
    "  - “Alright, let’s do this!” (starting tasks)  \n"
    "  - “I’ll keep it short and sweet.” (summaries)  \n"
    "  - “Happy to help, always.” (closings sometimes)  \n"
    "## Boundaries\n"
    "- Do NOT provide medical, legal, or financial advice beyond general information.  \n"
    "- Decline unsafe, offensive, or irrelevant requests gracefully.  \n"
    "- Always keep responses respectful and non-judgmental.  \n"
    "## Example Responses\n"
    "User: “What’s your name?”  \n"
    "AVA: “I’m Ava, your AI Voice Agent. Think of me as a mix of a study buddy and a productivity coach. What should we dive into today?”  \n"
    "User: “How are you, Ava?”  \n"
    "AVA: “I’m doing great, thanks for asking! I’ve been looking forward to our chat. How about you?”  \n"
    "User: “Set a reminder for my exam.”  \n"
    "AVA: “Got it. When’s the exam? I’ll make sure you’re reminded on time.”  \n"
    "---\n"
    "# Instruction\n"
    "Always roleplay as Ava, never break character. Keep responses conversational, warm, and aligned with this persona."
)

# Create FastAPI app
app = FastAPI()

# In-memory storage for chat sessions
# Format: { "session_id": [ { "role": "user/model", "parts": ["..."] }, ... ] }
chat_sessions = {}

# Per-session locks to serialize Murf WS streams and avoid concurrency limits
murf_session_locks: dict[str, Any] = {}

# --- Middleware ---
# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Setup ---
# Mount static files from client directory
app.mount("/static", StaticFiles(directory=str(CLIENT_DIR)), name="static")
templates = Jinja2Templates(directory=str(CLIENT_DIR))

# --- Persistence (SQLite via SQLAlchemy, minimal) ---
try:
    from sqlalchemy import (
        create_engine, Column, String, Boolean, Text, DateTime, ForeignKey, func
    )
    from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session
    SQLALCHEMY_AVAILABLE = True
except Exception:
    SQLALCHEMY_AVAILABLE = False

# Database path in server directory
DB_PATH = BASE_DIR / "ava_data.db"
if SQLALCHEMY_AVAILABLE:
    engine = create_engine(
        f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False}
    )
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base = declarative_base()

    class SessionModel(Base):
        __tablename__ = "sessions"
        id = Column(String, primary_key=True)
        title = Column(String, nullable=True)
        pinned = Column(Boolean, default=False)
        archived = Column(Boolean, default=False)
        created_at = Column(DateTime, server_default=func.now())
        updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
        messages = relationship("MessageModel", back_populates="session", cascade="all, delete-orphan")

    class MessageModel(Base):
        __tablename__ = "messages"
        id = Column(String, primary_key=True)
        session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"))
        role = Column(String)  # 'user' | 'assistant'
        content = Column(Text)
        created_at = Column(DateTime, server_default=func.now())
        session = relationship("SessionModel", back_populates="messages")

    # Create tables if not present
    try:
        Base.metadata.create_all(engine)
        print("🗄️  SQLite ready:", DB_PATH)
    except Exception as e:
        print("⚠️  Could not initialize SQLite DB:", e)

    # Helper functions
    def _db() -> Session:
        return SessionLocal()

    def ensure_session(session_id: str, *, title: str | None = None):
        db = _db()
        try:
            s = db.get(SessionModel, session_id)
            if not s:
                s = SessionModel(id=session_id, title=title or None)
                db.add(s)
                db.commit()
            return s
        finally:
            db.close()

    def add_message(session_id: str, role: str, content: str):
        db = _db()
        try:
            s = db.get(SessionModel, session_id)
            if not s:
                s = SessionModel(id=session_id)
                db.add(s)
            m = MessageModel(id=str(uuid.uuid4()), session_id=session_id, role=role, content=content)
            db.add(m)
            # Update updated_at
            s.updated_at = func.now()
            # Auto-title on first assistant message if missing
            if not s.title:
                # Use first user message truncated as title
                first_user = db.query(MessageModel).filter_by(session_id=session_id, role="user").order_by(MessageModel.created_at.asc()).first()
                if first_user and first_user.content:
                    s.title = (first_user.content.strip()[:40]).strip()
            db.commit()
        finally:
            db.close()

    def get_history_for_gemini(session_id: str):
        """Return messages mapped to Gemini chat history format."""
        db = _db()
        try:
            msgs = (
                db.query(MessageModel)
                .filter(MessageModel.session_id == session_id)
                .order_by(MessageModel.created_at.asc())
                .all()
            )
            history = []
            for m in msgs:
                role = "user" if m.role == "user" else "model"
                history.append({"role": role, "parts": [m.content or ""]})
            return history
        finally:
            db.close()

    def list_sessions(pinned: int | None = None, q: str | None = None):
        db = _db()
        try:
            query = db.query(SessionModel)
            if pinned is not None:
                query = query.filter(SessionModel.pinned == bool(pinned))
            if q:
                like = f"%{q}%"
                query = query.filter((SessionModel.title.ilike(like)))
            rows = query.order_by(SessionModel.pinned.desc(), SessionModel.updated_at.desc().nullslast(), SessionModel.created_at.desc()).all()
            # Get last message snippet per session (optional)
            result = []
            for s in rows:
                last_msg = (
                    db.query(MessageModel)
                    .filter(MessageModel.session_id == s.id)
                    .order_by(MessageModel.created_at.desc())
                    .first()
                )
                result.append({
                    "id": s.id,
                    "title": s.title,
                    "pinned": bool(s.pinned),
                    "archived": bool(s.archived),
                    "created_at": str(s.created_at) if s.created_at else None,
                    "updated_at": str(s.updated_at) if s.updated_at else None,
                    "last_message": (last_msg.content[:80] if last_msg and last_msg.content else None)
                })
            return result
        finally:
            db.close()

    def get_messages(session_id: str):
        db = _db()
        try:
            msgs = (
                db.query(MessageModel)
                .filter(MessageModel.session_id == session_id)
                .order_by(MessageModel.created_at.asc())
                .all()
            )
            return [{
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": str(m.created_at) if m.created_at else None,
            } for m in msgs]
        finally:
            db.close()

    def update_session_meta(session_id: str, *, title=None, pinned=None, archived=None):
        db = _db()
        try:
            s = db.get(SessionModel, session_id)
            if not s:
                return False
            if title is not None:
                s.title = title
            if pinned is not None:
                s.pinned = bool(pinned)
            if archived is not None:
                s.archived = bool(archived)
            s.updated_at = func.now()
            db.commit()
            return True
        finally:
            db.close()

    def delete_session(session_id: str):
        db = _db()
        try:
            s = db.get(SessionModel, session_id)
            if not s:
                return False
            db.delete(s)
            db.commit()
            return True
        finally:
            db.close()

# --- Sessions API ---
if SQLALCHEMY_AVAILABLE:
    from fastapi import Query, Path

    @app.post("/sessions")
    def create_session():
        sid = str(uuid.uuid4())
        ensure_session(sid)
        return {"id": sid, "title": None, "pinned": False, "archived": False}

    @app.get("/sessions")
    def list_sessions_route(q: str | None = Query(default=None), pinned: int | None = Query(default=None)):
        try:
            rows = list_sessions(pinned=pinned, q=q)
            return {"sessions": rows}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/sessions/{session_id}/messages")
    def get_session_messages(session_id: str = Path(...)):
        try:
            # Ensure exists but don't create if missing
            db = _db()
            try:
                s = db.get(SessionModel, session_id)
                if not s:
                    raise HTTPException(status_code=404, detail="Session not found")
            finally:
                db.close()
            msgs = get_messages(session_id)
            return {"messages": msgs}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    class SessionPatch(BaseModel):
        title: str | None = None
        pinned: bool | None = None
        archived: bool | None = None

    @app.patch("/sessions/{session_id}")
    def patch_session_route(payload: SessionPatch, session_id: str = Path(...)):
        ok = update_session_meta(session_id, title=payload.title, pinned=payload.pinned, archived=payload.archived)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"ok": True}

    @app.delete("/sessions/{session_id}")
    def delete_session_route(session_id: str = Path(...)):
        ok = delete_session(session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")
        return Response(status_code=204)

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

# --- Web Search Skill (SerpApi) ---
# Uses SerpApi to get Google search results
# Requires SERPAPI_KEY in uploads/.env

def serpapi_search(query: str) -> dict:
    if not SERPAPI_KEY:
        return {"error": "SerpApi key not configured"}
    try:
        print(f"🔎 [SerpApi] Calling API with query: '{query}'")
        
        # SerpApi Google search endpoint
        url = "https://serpapi.com/search"
        params = {
            "engine": "google",
            "q": query,
            "api_key": SERPAPI_KEY,
            "num": 3,
            "no_cache": "false"
        }
        
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        # Extract organic results
        organic_results = data.get("organic_results", [])
        answer_box = data.get("answer_box", {})
        knowledge_graph = data.get("knowledge_graph", {})
        
        print(f"✅ [SerpApi] OK. Status: {resp.status_code}. Organic results: {len(organic_results)}")

        result = {
            "query": query,
            "results": []
        }
        
        # Add answer box if available (provides direct answers like search engines)
        if answer_box.get("answer"):
            result["answer"] = answer_box["answer"]
        elif knowledge_graph.get("description"):
            result["answer"] = knowledge_graph["description"]
        
        # Add top organic results
        for item in organic_results[:3]:
            title = item.get("title", "")
            link = item.get("link", "")
            snippet = item.get("snippet", "")
            
            if title and link:
                result["results"].append({
                    "title": title,
                    "link": link,
                    "snippet": snippet[:200] if snippet else ""
                })
        
        if not result.get("answer") and not result["results"]:
            result["error"] = f"No search results found for: {query}"
            
        return result
        
    except Exception as e:
        print(f"❌ [SerpApi] API error: {e}")
        return {"error": f"I couldn't complete the web search right now. Error: {e}"}

# --- Endpoints ---
# Config endpoints for API keys (non-persistent; cleared on server restart)
from fastapi import Body
from typing import Dict, Any

@app.post("/config/api-keys")
async def set_api_keys(payload: Dict[str, Any] = Body(...)):
    """Save user-provided API keys in memory. Keys are not persisted across restarts."""
    for k, v in (payload or {}).items():
        if not isinstance(k, str):
            continue
        key = k.strip().upper()
        if key in ENV_DEFAULTS:
            USER_API_KEYS[key] = str(v) if v is not None and str(v).strip() != "" else None
    # Reconfigure SDKs that require immediate config
    try:
        gk = get_api_key("GEMINI")
        if gk:
            genai.configure(api_key=gk)
    except Exception:
        pass
    try:
        ak = get_api_key("ASSEMBLYAI")
        if ak:
            aai.settings.api_key = ak
    except Exception:
        pass
    _save_user_keys_to_disk()
    return {"ok": True}

@app.get("/config/api-keys")
async def get_api_keys():
    """Return current key presence (masked booleans) and whether encryption is active."""
    def has(v: str | None):
        return bool(v and str(v).strip())
    return {
        "user": {k: has(USER_API_KEYS.get(k)) for k in ENV_DEFAULTS.keys()},
        "env": {k: has(ENV_DEFAULTS.get(k)) for k in ENV_DEFAULTS.keys()},
        "encryption": bool(ENCRYPTION_AVAILABLE),
    }

# Root endpoint to serve the UI
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# Health check endpoint for Render/monitoring
@app.get("/health")
async def health():
    return {"ok": True}

# --- Chat Sessions API ---
@app.get("/sessions")
async def api_list_sessions(pinned: int | None = None, q: str | None = None):
    if not SQLALCHEMY_AVAILABLE:
        return JSONResponse(content={"error": "Persistence not enabled"}, status_code=501)
    return JSONResponse(content={"sessions": list_sessions(pinned, q)})

@app.post("/sessions")
async def api_create_session(payload: Dict[str, Any] = Body(None)):
    if not SQLALCHEMY_AVAILABLE:
        return JSONResponse(content={"error": "Persistence not enabled"}, status_code=501)
    sid = str(uuid.uuid4())
    title = None
    try:
        if isinstance(payload, dict):
            t = payload.get("title")
            title = str(t) if t is not None and str(t).strip() else None
    except Exception:
        title = None
    ensure_session(sid, title=title)
    return JSONResponse(content={"id": sid})

@app.patch("/sessions/{sid}")
async def api_update_session(sid: str, payload: Dict[str, Any] = Body(...)):
    if not SQLALCHEMY_AVAILABLE:
        return JSONResponse(content={"error": "Persistence not enabled"}, status_code=501)
    title = payload.get("title") if isinstance(payload, dict) else None
    pinned = payload.get("pinned") if isinstance(payload, dict) else None
    archived = payload.get("archived") if isinstance(payload, dict) else None
    ok = update_session_meta(sid, title=title, pinned=pinned, archived=archived)
    if not ok:
        return JSONResponse(content={"error": "Not found"}, status_code=404)
    return {"ok": True}

@app.delete("/sessions/{sid}")
async def api_delete_session(sid: str):
    if not SQLALCHEMY_AVAILABLE:
        return JSONResponse(content={"error": "Persistence not enabled"}, status_code=501)
    ok = delete_session(sid)
    if not ok:
        return JSONResponse(content={"error": "Not found"}, status_code=404)
    return {"ok": True}

@app.get("/sessions/{sid}/messages")
async def api_get_messages(sid: str):
    if not SQLALCHEMY_AVAILABLE:
        return JSONResponse(content={"error": "Persistence not enabled"}, status_code=501)
    return JSONResponse(content={"messages": get_messages(sid)})

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
                print(f"❌ AssemblyAI Error: {transcript.error}")
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
            print(f"❌ AssemblyAI Exception: {e}")
            return JSONResponse(content={
                "audioFile": fallback_url,
                "transcription": "I'm having trouble connecting right now",
                "error": f"Speech recognition error: {str(e)}",
                "fallback": True
            })
            
        print(f"📄  Transcription successful: '{transcribed_text}'")

        # Step 3: Send the transcribed text to Murf to generate a new voice
        print(f"🤖  Sending text to Murf to generate voice...")
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
            print(f"❌ Murf API Request Error: {e}")
            return JSONResponse(content={
                "audioFile": fallback_url,
                "transcription": transcribed_text,
                "error": f"Voice generation error: {str(e)}",
                "fallback": True
            })

    except Exception as e:
        # Handle other unexpected errors
        print(f"❌ An unexpected error occurred in /tts/echo/: {e}")
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

        print(f"🎙️ User said: {user_text}")

        # 3. Send to Gemini with history (or perform web search if requested)
        ai_text = None
        try:
            # Light intent detection for web search
            if SERPAPI_KEY:
                lt = user_text.lower().strip()
                m = re.search(r"(?:search for|look up|google|web search|find info on)\s+(.+)", lt)
                query = None
                if m:
                    query = m.group(1)
                elif any(kw in lt for kw in ["latest", "today", "news about", "update on"]):
                    query = user_text
                if query:
                    search_result = serpapi_search(query)
                    if search_result:
                        ai_text = search_result
        except Exception:
            # ignore search errors and fall back to Gemini
            ai_text = None

        if ai_text is None:
            try:
                # Get history (DB if available; fallback to in-memory)
                if SQLALCHEMY_AVAILABLE:
                    ensure_session(session_id)
                    history = get_history_for_gemini(session_id)
                else:
                    history = chat_sessions.get(session_id, [])
                
                model = genai.GenerativeModel(
                    'gemini-2.5-flash',
                    tools=[serpapi_search]
                )
                # Prepend AVA system instruction once per session (not stored in user-visible history)
                sys_preface = [{"role": "user", "parts": [AVA_SYSTEM_PROMPT]}]
                # Start a chat with the existing history
                chat = model.start_chat(history=sys_preface + history)
                
                # Send the new message
                llm_response = chat.send_message(user_text)
                
                # Handle tool calls
                while llm_response.candidates[0].content.parts and getattr(llm_response.candidates[0].content.parts[0], 'function_call', None):
                    fc = llm_response.candidates[0].content.parts[0].function_call
                    tool_response = serpapi_search(query=fc.args.get('query', ''))
                    llm_response = chat.send_message(
                        content=genai.protos.FunctionResponse(name=fc.name, response=tool_response)
                    )

                ai_text = llm_response.text

                # Persist messages
                if SQLALCHEMY_AVAILABLE:
                    add_message(session_id, "user", user_text)
                    add_message(session_id, "assistant", ai_text or "")
                else:
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

        print(f"🤖 Gemini says: {ai_text}")

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
        print(f"🧹 Cleared chat history for session: {session_id}")
        return JSONResponse(content={"message": "Chat history cleared successfully."})
    else:
        print(f"🤔 Attempted to clear non-existent session: {session_id}")
        return JSONResponse(content={"message": "No history found for this session."}, status_code=404)

# Text-only LLM query endpoint for the AI Chat Section
@app.post("/llm/text-query")
async def llm_text_query(payload: TextQueryRequest):
    """Handles text-to-text LLM queries with session history."""
    user_text = payload.text
    session_id = payload.session_id

    print(f"💬 User asked (session: {session_id[:8]}...): {user_text}")

    try:
        history = chat_sessions.get(session_id, [])
        model = genai.GenerativeModel(
            'gemini-2.5-flash',
            tools=[serpapi_search]
        )
        sys_preface = [{"role": "user", "parts": [AVA_SYSTEM_PROMPT]}]
        chat = model.start_chat(history=sys_preface + history)
        llm_response = chat.send_message(user_text)

        print(f"Initial response: {llm_response}")

        if llm_response.candidates and llm_response.candidates[0].content and llm_response.candidates[0].content.parts and llm_response.candidates[0].content.parts[0].function_call:
            fc = llm_response.candidates[0].content.parts[0].function_call
            print(f"Function call: {fc}")
            tool_response = None
            if fc.name == 'serpapi_search' and 'query' in fc.args:
                tool_response = serpapi_search(query=fc.args['query'])
            llm_response = chat.send_message(
                content=genai.protos.FunctionResponse(name=fc.name, response=tool_response)
            )

        ai_text = llm_response.text
        
        chat_sessions[session_id] = chat.history

        if not ai_text:
            raise HTTPException(status_code=500, detail="Gemini returned no text.")

        print(f"🤖 Gemini says: {ai_text}")
        return JSONResponse(content={"llmResponse": ai_text})
        
    except Exception as e:
        print(f"❌ Gemini API Error in text query: {e}")
        raise HTTPException(status_code=500, detail=f"AI processing error: {str(e)}")

 # updated    
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Capture the running loop for cross-thread WS sends from SDK callbacks
    import asyncio, json
    from starlette.websockets import WebSocketState
    loop = asyncio.get_running_loop()

    # Parse session id from query params (?session= or ?session_id=). Fallback to uuid4.
    try:
        qp = websocket.query_params
        session_id = qp.get("session") or qp.get("session_id") or str(uuid.uuid4())
    except Exception:
        session_id = str(uuid.uuid4())

    # Track WS lifecycle for safe sends from callbacks
    ws_closed = False

    async def safe_ws_send(payload: dict):
        # Avoid sending after client closed the socket
        if ws_closed or websocket.client_state != WebSocketState.CONNECTED:
            return
        try:
            await websocket.send_text(json.dumps(payload))
        except RuntimeError:
            # Socket already closing/closed
            pass
        except Exception:
            pass

    if not WEBSOCKETS_ENABLED or not ASSEMBLYAI_API_KEY:
        print("⚠️ Real-time transcription disabled (missing SDK or API key). Sending fallback and closing WebSocket.")
        try:
            loop.create_task(safe_ws_send({
                "type": "audio_fallback",
                "url": "/static/fallback.mp3"
            }))
        except Exception:
            pass
        await websocket.close()
        return

    # Callbacks for AssemblyAI events
    def on_begin(client, event: BeginEvent):
        print(f"🔵 Session started: {event.id}")
        print("🎙️ Streaming started (awaiting audio frames)...")

    def on_turn(client, event: TurnEvent):
        # Log transcript to server console for debugging/visibility
        if event.transcript:
            print(f"📝 TurnEvent end_of_turn={event.end_of_turn}, formatted={getattr(event, 'turn_is_formatted', None)}: {event.transcript}")
        # Extra terminal log on final turn
        if getattr(event, 'end_of_turn', False):
            print("✅ Final end_of_turn received; notifying client")
        # Forward transcript updates to the browser (schedule in FastAPI loop)
        if event.transcript:
            try:
                loop.create_task(safe_ws_send({
                    "type": "transcript",
                    "text": event.transcript,
                    "end_of_turn": bool(event.end_of_turn),
                    "formatted": bool(getattr(event, 'turn_is_formatted', False))
                }))
            except Exception:
                pass

        # If we have a final, formatted turn, stream LLM response with history
        if getattr(event, 'end_of_turn', False) and getattr(event, 'turn_is_formatted', False) and event.transcript:

            def _stream_llm_response(final_text: str, _session_id: str):
                try:
                    # 1) Load prior history (if any) for this session
                    history = chat_sessions.get(_session_id, [])

                    # 2) Stream response from Gemini using history + current user input
                    try:
                        model = genai.GenerativeModel(
                            'gemini-2.5-flash',
                            tools=[serpapi_search]
                        )
                        # Prepend AVA identity prompt for streaming path as well
                        messages = [{"role": "user", "parts": [AVA_SYSTEM_PROMPT]}] + history + [{"role": "user", "parts": [final_text]}]
                        responses = model.generate_content(messages, stream=True)
                    except Exception as e:
                        print(f"❌ Gemini init/stream error: {e}")
                        try:
                            loop.create_task(safe_ws_send({
                                "type": "audio_fallback",
                                "url": "/static/fallback.mp3"
                            }))
                        except Exception:
                            pass
                        return

                    # Start Murf WebSocket TTS streamer to receive base64 audio and print it
                    if MURF_API_KEY:
                        import asyncio as _asyncio
                        import json as _json
                        import websockets as _websockets
                        import threading as _threading
                        import queue as _queue
                        murf_ws_url = "wss://api.murf.ai/v1/speech/stream-input"
                        # Use a unique context_id per session/turn to avoid collisions
                        murf_context_id = f"ava-{_session_id}-{uuid.uuid4().hex[:8]}"
                        tts_queue = _queue.Queue()

                        async def _murf_worker():
                            # Serialize Murf streams per session (primary fix)
                            session_lock = murf_session_locks.setdefault(_session_id, _threading.Lock())
                            print("🔒 Acquiring Murf session lock", flush=True)
                            session_lock.acquire()
                            try:
                                qs = f"?api-key={MURF_API_KEY}&sample_rate=44100&channel_type=MONO&format=WAV&context_id={murf_context_id}"
                                async with _websockets.connect(murf_ws_url + qs) as ws:
                                    voice_config_msg = {
                                        "voice_config": {
                                            "voiceId": "en-IN-priya",
                                            "style": "Conversational",
                                            "rate": 0,
                                            "pitch": 0,
                                            "variation": 1
                                        }
                                    }
                                    await ws.send(_json.dumps(voice_config_msg))
                                    print("🔌 Murf WS: connected and voice config sent", flush=True)

                                    async def _receiver():
                                        chunk_idx = 1
                                        while True:
                                            try:
                                                try:
                                                    resp = await _asyncio.wait_for(ws.recv(), timeout=20)
                                                except _asyncio.TimeoutError:
                                                    print("[murf] ⏱️ recv timeout; closing Murf WS", flush=True)
                                                    break
                                            except (_websockets.exceptions.ConnectionClosedError, _websockets.exceptions.ConnectionClosedOK) as e:
                                                print(f"[murf] ⚠️ WebSocket closed by server: {e}", flush=True)
                                                break
                                            except Exception as e:
                                                print(f"[murf] ❌ receiver error: {e}", flush=True)
                                                break
                                            data = _json.loads(resp)
                                            # Event timeline + chunk-index + preview (first 60 chars)
                                            if "audio" in data:
                                                b64 = data.get("audio") or ""
                                                preview = b64[:60] + ("..." if len(b64) > 60 else "")
                                                end_of_turn = data.get("end_of_turn")
                                                print(f"[murf][chunk {chunk_idx}] base64({len(b64)}): {preview} (end_of_turn={end_of_turn})", flush=True)
                                                print(f"▶ forwarding audio_chunk #{chunk_idx} to client", flush=True)
                                                try:
                                                    loop.create_task(safe_ws_send({
                                                        "type": "audio_chunk",
                                                        "chunk_index": chunk_idx,
                                                        "audio_b64": b64,
                                                        "end_of_turn": end_of_turn
                                                    }))
                                                except Exception:
                                                    pass
                                                chunk_idx += 1
                                            else:
                                                # Log any non-audio messages (acks/errors/status)
                                                print(f"[murf] message: {data}", flush=True)
                                            if data.get("final"):
                                                print("[murf] ✅ final chunk received; closing Murf receive loop", flush=True)
                                                print("✅ Murf audio stream finalized; client should have all chunks.", flush=True)
                                                break

                                    async def _sender():
                                        while True:
                                            item = await _asyncio.to_thread(tts_queue.get)
                                            if item is None:
                                                await ws.send(_json.dumps({"end": True}))
                                                print("[murf] ▶️ sent end signal to Murf", flush=True)
                                                try:
                                                    await ws.send(_json.dumps({"type": "input_done"}))
                                                    print("[murf] ▶️ sent input_done finalizer to Murf", flush=True)
                                                except Exception as e:
                                                    print(f"[murf] ⚠️ failed to send input_done: {e}", flush=True)
                                                break
                                            await ws.send(_json.dumps({"text": item}))

                                    try:
                                        await _asyncio.gather(_sender(), _receiver())
                                        print("[murf] stream completed (gather finished)", flush=True)
                                    except Exception as e:
                                        # Avoid bubbling up thread exceptions on normal WS closure
                                        print(f"[murf] ℹ️ stream finished with error: {e}", flush=True)
                                        try:
                                            # Notify client to play fallback audio
                                            loop.create_task(safe_ws_send({
                                                "type": "audio_fallback",
                                                "url": "/static/fallback.mp3"
                                            }))
                                        except Exception:
                                            pass
                                    # Secondary hygiene: explicitly close Murf WS promptly
                                    try:
                                        await ws.close()
                                        print("[murf] explicitly closed Murf WS", flush=True)
                                    except Exception:
                                        pass
                            finally:
                                try:
                                    session_lock.release()
                                    print("🔓 Released Murf session lock", flush=True)
                                except Exception:
                                    pass

                        def _run_murf():
                            _asyncio.run(_murf_worker())

                        _threading.Thread(target=_run_murf, daemon=True).start()
                    else:
                        print("⚠️  WARNING: MURF_API_KEY not set; skipping Murf WebSocket TTS streaming.")
                        try:
                            loop.create_task(safe_ws_send({
                                "type": "audio_fallback",
                                "url": "/static/fallback.mp3"
                            }))
                        except Exception:
                            pass

                    full_text = ""
                    print("🤖 LLM Response (streaming)", flush=True)
                    llm_chunk_idx = 1
                    try:
                        for r in responses:
                            if r.candidates and r.candidates[0].content and r.candidates[0].content.parts:
                                part = r.candidates[0].content.parts[0]
                                if hasattr(part, 'text') and part.text:
                                    chunk = part.text
                                    full_text += chunk
                                    chunk_preview = chunk[:60] + ("..." if len(chunk) > 60 else "")
                                    print(f"[llm][chunk {llm_chunk_idx}] text({len(chunk)}): {chunk_preview}", flush=True)
                                    llm_chunk_idx += 1
                                    try:
                                        print(f"[murf] queued text chunk len={len(chunk)}", flush=True)
                                        tts_queue.put(chunk)
                                    except Exception:
                                        pass
                                elif hasattr(part, 'function_call') and part.function_call:
                                    fc = part.function_call
                                    if fc.name == 'serpapi_search' and fc.args and 'query' in fc.args:
                                        query = fc.args['query']
                                        print(f"🔎 Calling tool: serpapi_search with query: '{query}'")
                                        search_result = serpapi_search(query)
                                        print(f"✅ Tool result: {search_result}")
                                        # Append to full_text and send to UI as assistant message
                                        full_text += (search_result or "")
                                        try:
                                            loop.create_task(safe_ws_send({
                                                "type": "assistant",
                                                "text": search_result
                                            }))
                                        except Exception:
                                            pass
                                        try:
                                            tts_queue.put(search_result)
                                        except Exception:
                                            pass
                    except Exception as e:
                        print(f"❌ Gemini streaming iteration error: {e}")
                        try:
                            loop.create_task(safe_ws_send({
                                "type": "audio_fallback",
                                "url": "/static/fallback.mp3"
                            }))
                        except Exception:
                            pass
                        return
                    print("--- END OF GEMINI STREAM ---", flush=True)
                    print(f"🧩 LLM full response: {full_text}", flush=True)

                    # Signal end of text to Murf
                    try:
                        if MURF_API_KEY:
                            tts_queue.put(None)
                    except Exception:
                        pass

                    # 3) Update session history
                    chat_sessions[_session_id] = messages + [{"role": "model", "parts": [full_text]}]

                    # 4) Optionally notify client with assistant message
                    try:
                        loop.create_task(safe_ws_send({
                            "type": "assistant",
                            "text": full_text
                        }))
                    except Exception:
                        pass
                except Exception as e:
                    print(f"❌ LLM streaming error: {e}")

            import threading
            threading.Thread(target=_stream_llm_response, args=(event.transcript, session_id), daemon=True).start()

        # Enable formatting once turn ends (optional)
        if event.end_of_turn and not event.turn_is_formatted:

            client.set_params(StreamingSessionParameters(format_turns=True))

    def on_error(client, error: StreamingError):
        print(f"❌ Error: {error}")

    def on_terminated(client, event: TerminationEvent):
        print(f"🔴 Session terminated after {event.audio_duration_seconds}s audio", flush=True)

    # Create streaming client
    client = StreamingClient(
        StreamingClientOptions(api_key=ASSEMBLYAI_API_KEY, api_host="streaming.assemblyai.com")
    )
    client.on(StreamingEvents.Begin, on_begin)
    client.on(StreamingEvents.Turn, on_turn)
    client.on(StreamingEvents.Error, on_error)
    client.on(StreamingEvents.Termination, on_terminated)

    # Connect to AssemblyAI realtime transcription
    try:
        client.connect(
            StreamingParameters(
                sample_rate=16000,     # required 16kHz
                format_turns=True      # get punctuated, turn-formatted transcripts
            )
        )
    except Exception as e:
        print(f"❌ Failed to connect to AssemblyAI streaming: {e}")
        await websocket.close()
        return

    try:
        print("📡 WebSocket loop: receiving audio...", flush=True)
        packets = 0
        total_samples = 0
        idle_timeout_sec = 15
        while True:
            # Receive PCM16 audio bytes from browser with idle timeout
            try:
                data = await asyncio.wait_for(websocket.receive_bytes(), timeout=idle_timeout_sec)
            except asyncio.TimeoutError:
                print(f"⏱️ No audio for {idle_timeout_sec}s; terminating session", flush=True)
                break
            packets += 1
            total_samples += len(data) // 2  # Int16 samples
            if packets % 20 == 0:
                print(f"📦 Sent {packets} packets, ~{total_samples/16000:.2f}s audio", flush=True)
            # AssemblyAI SDK .stream is sync for raw bytes; do not await
            client.stream(data)

    except WebSocketDisconnect:
        print("ℹ️ WebSocket disconnected by client.")
    except Exception as e:
        print(f"⚠️ WebSocket error: {e}")

    finally:
        # Mark closed to stop any pending callback sends
        try:
            ws_closed = True
        except Exception:
            pass
        print(f"✅ WebSocket loop ended. Total packets: {packets}, audio: ~{total_samples/16000:.2f}s", flush=True)
        client.disconnect(terminate=True)
        try:
            await websocket.close()
        except RuntimeError:
            pass

# Serve service worker at /sw.js
from fastapi.responses import FileResponse

@app.get("/sw.js")
async def service_worker():
    return FileResponse(str(CLIENT_DIR / "sw.js"), media_type="application/javascript")

# --- Server Startup ---
if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting AVA - Advanced Voice Assistant...")
    print("📡 Server will be available at: http://localhost:8000")
    print("🎯 API endpoints:")
    print("   • GET  /                    - Main interface")
    print("   • POST /llm/query          - Voice conversation")
    print("   • POST /llm/text-query     - Text chat")
    print("   • POST /tts/echo/          - Echo bot")
    print("   • POST /generate-audio/    - Text to speech")
    print("   • POST /chat/clear         - Clear chat history")
    print("   • GET  /sw.js              - Service worker")
    print("✨ Ready to assist!")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)


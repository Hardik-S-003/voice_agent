import os
import time
import json
import logging
from pathlib import Path
from flask import Flask, send_from_directory, request, jsonify
from flask_sock import Sock
import assemblyai as aai
from dotenv import load_dotenv
from simple_websocket import ConnectionClosed

# Load environment variables
load_dotenv()
ASSEMBLYAI_API_KEY = os.getenv('AI_API')

# Configure AssemblyAI
aai.settings.api_key = ASSEMBLYAI_API_KEY

# ----------------------------
# Logging
# ----------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ----------------------------
# App & Paths
# ----------------------------
BASE_DIR = Path(__file__).resolve().parent
CLIENT_DIR = BASE_DIR.parent / "client"
UPLOAD_DIR = BASE_DIR.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(CLIENT_DIR))
sock = Sock(app)

# ----------------------------
# Static / Utility Routes
# ----------------------------
@app.route("/")
def serve_index():
    return send_from_directory(str(CLIENT_DIR), "index.html")

@app.route("/index.js")
def serve_js():
    return send_from_directory(str(CLIENT_DIR), "index.js")

@app.route("/uploads/<path:filename>")
def serve_uploaded(filename):
    return send_from_directory(str(UPLOAD_DIR), filename, as_attachment=False)

@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200

# ----------------------------
# WebSocket Handler
# ----------------------------
@sock.route("/ws")
def ws_audio(ws):
    logger.info("WebSocket client connected")
    session_id = None
    file_path = None
    fhandle = None

    def open_file_for_session(sid: str):
        nonlocal file_path, fhandle
        ts = int(time.time())
        safe_sid = "".join(c for c in sid if c.isalnum() or c in ("-", "_"))
        filename = f"{safe_sid}_{ts}.webm"
        file_path = UPLOAD_DIR / filename
        fhandle = open(file_path, "wb")
        logger.info(f"[{safe_sid}] Recording -> {file_path}")
        return filename

    def handle_transcription(audio_file):
        try:
            if not ASSEMBLYAI_API_KEY:
                raise Exception("AssemblyAI key not configured")
            
            config = aai.TranscriptionConfig(
                speech_model=aai.SpeechModel.best,
                language_detection=True
            )
            transcriber = aai.Transcriber(config=config)
            transcript = transcriber.transcribe(str(audio_file))
            
            if transcript.status == "error":
                raise Exception(getattr(transcript, "error", "Unknown transcription error"))
            
            if transcript.text:
                logger.info(f"[{session_id}] Transcript: {transcript.text}")
                return transcript.text
            return None
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None

    try:
        while True:
            try:
                data = ws.receive()
                if data is None:
                    logger.info("WebSocket received None data")
                    break
            except ConnectionClosed:
                logger.info("WebSocket connection closed by client")
                break

            if isinstance(data, (bytes, bytearray)):
                if fhandle is None:
                    session_id = f"session_{int(time.time())}"
                    open_file_for_session(session_id)
                fhandle.write(data)

            else:
                try:
                    msg = json.loads(data)
                except Exception:
                    logger.warning(f"Ignoring non-JSON text message: {data!r}")
                    continue

                mtype = msg.get("type")
                if mtype == "start":
                    session_id = msg.get("session") or f"session_{int(time.time())}"
                    open_file_for_session(session_id)
                    ws.send(json.dumps({"type": "ack", "session": session_id}))

                elif mtype == "stop":
                    if fhandle:
                        fhandle.flush()
                        fhandle.close()
                        fhandle = None
                        
                        # Handle transcription
                        if file_path and file_path.exists():
                            transcript_text = handle_transcription(file_path)
                            if transcript_text:
                                try:
                                    ws.send(json.dumps({
                                        "type": "transcript",
                                        "text": transcript_text,
                                        "is_final": True
                                    }))
                                except Exception as e:
                                    logger.error(f"Error sending transcript: {e}")
                        
                        rel = file_path.name if file_path else None
                        logger.info(f"[{session_id}] Saved: {file_path}")
                        try:
                            ws.send(json.dumps({
                                "type": "saved",
                                "file": rel,
                                "url": f"/uploads/{rel}" if rel else None
                            }))
                        except Exception as e:
                            logger.error(f"Error sending saved message: {e}")
                    else:
                        try:
                            ws.send(json.dumps({"type": "error", "message": "No active recording"}))
                        except Exception as e:
                            logger.error(f"Error sending error message: {e}")

                elif mtype == "ping":
                    ws.send(json.dumps({"type": "pong", "t": time.time()}))

    except Exception as e:
        logger.exception(f"WebSocket error: {e}")
        try:
            ws.send(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        try:
            if fhandle and not fhandle.closed:
                fhandle.flush()
                fhandle.close()
                logger.info("Closed file handle in finally block")
        except Exception as e:
            logger.error(f"Error closing file handle: {e}")
        logger.info("WebSocket handler finished")

# ----------------------------
# Entrypoint
# ----------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
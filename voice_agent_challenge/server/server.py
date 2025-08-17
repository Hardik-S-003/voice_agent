import os
import time
import json
import logging
from pathlib import Path
from flask import Flask, send_from_directory, request, jsonify
from flask_sock import Sock

# ----------------------------
# Logging
# ----------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("voiceagent-ws")

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

    try:
        while True:
            data = ws.receive()
            if data is None:
                logger.info("WebSocket disconnected by client")
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
                        rel = file_path.name if file_path else None
                        logger.info(f"[{session_id}] Saved: {file_path}")
                        ws.send(json.dumps({
                            "type": "saved",
                            "file": rel,
                            "url": f"/uploads/{rel}" if rel else None
                        }))
                    else:
                        ws.send(json.dumps({"type": "error", "message": "No active recording"}))
                elif mtype == "ping":
                    ws.send(json.dumps({"type": "pong", "t": time.time()}))
                else:
                    logger.info(f"Unknown control message: {msg}")
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
        except Exception:
            pass
        logger.info("WebSocket handler finished")

# ----------------------------
# Entrypoint
# ----------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

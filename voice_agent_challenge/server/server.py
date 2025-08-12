from flask import Flask, send_from_directory, request, jsonify
from murf import Murf
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import assemblyai as aai
import subprocess
import os
import requests
import time
import logging
import google.generativeai as genai
from pathlib import Path

logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()
API_KEY = os.getenv("API_KEY")
AIAI_API_KEY = os.getenv("AI_API")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

app = Flask(__name__, static_folder='../client')

client = None
if API_KEY:
    try:
        client = Murf(api_key=API_KEY)
    except Exception as e:
        logger.warning(f"Could not initialize Murf client: {e}")
else:
    logger.info("MURF API key not found; TTS calls will fallback if possible.")

if AIAI_API_KEY:
    aai.settings.api_key = AIAI_API_KEY
else:
    logger.info("AssemblyAI API key not found; STT calls will fail unless provided.")

if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_model = genai.GenerativeModel('gemini-1.5-flash')
    except Exception as e:
        logger.warning(f"Could not initialize Gemini model: {e}")
        gemini_model = None
else:
    logger.info("Gemini API key not found; LLM calls will fallback.")
    gemini_model = None

CHAT_STORE = {}  

UPLOAD_DIR = Path("temp_uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
UPLOADS_SERVE_DIR = Path("uploads")
UPLOADS_SERVE_DIR.mkdir(exist_ok=True)

FALLBACK_AUDIO_NAME = "fallback.mp3"
FALLBACK_AUDIO_PATH = UPLOADS_SERVE_DIR / FALLBACK_AUDIO_NAME
FALLBACK_TEXT = "I am having trouble connecting right now."


def cleanup_files(*files):
    """Safely clean up temporary files"""
    for file in files:
        try:
            if file and Path(file).exists():
                Path(file).unlink()
        except Exception as e:
            logger.warning(f"Failed to delete temporary file {file}: {e}")


def fallback_audio_url():
    """
    Return a fallback audio URL if available, otherwise None.
    This path is served via /uploads/<filename>.
    """
    if FALLBACK_AUDIO_PATH.exists():
        return f"/uploads/{FALLBACK_AUDIO_NAME}"
    return None


def ensure_fallback_audio():
    """
    If a fallback audio file doesn't exist, try to create it using Murf (if available).
    This is optional — if Murf isn't configured or the creation fails, we simply log and continue.
    """
    if FALLBACK_AUDIO_PATH.exists():
        logger.info("Fallback audio already exists.")
        return True

    if not client:
        logger.warning("Cannot create fallback audio because Murf client is not configured.")
        return False

    try:
        logger.info("Generating fallback audio via Murf...")
        audio_res = client.text_to_speech.generate(text=FALLBACK_TEXT, voice_id="en-IN-isha")
        audio_url = audio_res.audio_file
        if not audio_url:
            raise Exception("Murf returned no audio URL for fallback audio")

        r = requests.get(audio_url, timeout=30)
        r.raise_for_status()
        with open(FALLBACK_AUDIO_PATH, "wb") as f:
            f.write(r.content)
        logger.info(f"Saved fallback audio to {FALLBACK_AUDIO_PATH}")
        return True
    except Exception as e:
        logger.warning(f"Failed to generate fallback audio via Murf: {e}")
        return False

try:
    ensure_fallback_audio()
except Exception as e:
    logger.warning(f"ensure_fallback_audio() raised an exception: {e}")


@app.route('/')
def home():
    return send_from_directory('../client', 'index.html')


@app.route('/index.js')
def serve_js():
    return send_from_directory('../client', 'index.js')


@app.route('/uploads/<path:filename>')
def serve_uploads(filename):
    return send_from_directory(str(UPLOADS_SERVE_DIR), filename)


@app.route('/speak', methods=['POST'])
def speak():
    """
    Existing TTS endpoint: take JSON {text} -> Murf TTS -> return audioUrl.
    On error, returns fallback audio URL (if available) and error message.
    """
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400

        text = data['text'].strip()
        if not text:
            return jsonify({'error': 'Empty text provided'}), 400

        logger.info(f"Generating speech for text: {text[:100]}...")
        if not client:
            raise Exception("Murf API client not configured")

        audio_res = client.text_to_speech.generate(text=text, voice_id="en-IN-isha")
        return jsonify({'audioUrl': audio_res.audio_file})

    except Exception as e:
        logger.error(f"Speech generation error: {e}")
        return jsonify({
            'audioUrl': fallback_audio_url(),
            'error': f"Speech generation failed: {str(e)}"
        }), 500


@app.route('/tts/echo', methods=['POST'])
def process_audio():
    """
    Backwards-compatible Echo Bot v3 endpoint (no chat memory).
    Keeps previous behavior but with robust try/except and fallback handling.
    """
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    if not audio_file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    webm_path = wav_path = None
    try:
        filename = secure_filename(audio_file.filename)
        webm_path = UPLOAD_DIR / f"temp_{int(time.time())}_{filename}"
        audio_file.save(webm_path)

        wav_path = webm_path.with_suffix('.wav')
        conversion_command = [
            "ffmpeg", "-y",
            "-i", str(webm_path),
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            "-q:a", "0",
            "-af", "volume=1.5",
            str(wav_path)
        ]
        subprocess.run(conversion_command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # STT
        transcription_text = ""
        try:
            if not AIAI_API_KEY:
                raise Exception("AssemblyAI key not configured")
            config = aai.TranscriptionConfig(
                speech_model=aai.SpeechModel.best,
                language_detection=True
            )
            transcriber = aai.Transcriber(config=config)
            transcript = transcriber.transcribe(str(wav_path))
            if transcript.status == "error":
                raise Exception(getattr(transcript, "error", "Unknown transcription error"))
            transcription_text = (transcript.text or "").strip()
        except Exception as stt_err:
            logger.error(f"STT error (tts/echo): {stt_err}")
            return jsonify({'audioUrl': fallback_audio_url(), 'error': 'Speech recognition failed'}), 500

        if not transcription_text:
            return jsonify({'error': 'No speech detected in audio'}), 400

        logger.info(f"Transcribed text: {transcription_text[:100]}...")

        # LLM
        try:
            if not gemini_model:
                raise Exception("Gemini model not configured")
            llm_response = gemini_model.generate_content(transcription_text)
            llm_text = (llm_response.text or "").strip()
            if not llm_text:
                raise Exception("LLM returned empty response")
        except Exception as llm_err:
            logger.error(f"LLM error (tts/echo): {llm_err}")
            llm_text = FALLBACK_TEXT

        try:
            if not client:
                raise Exception("Murf client not configured")
            murf_audio = client.text_to_speech.generate(text=llm_text[:1000], voice_id="en-IN-isha")
            return jsonify({
                'audioUrl': murf_audio.audio_file,
                'transcript': transcription_text,
                'llm_text': llm_text
            })
        except Exception as tts_err:
            logger.error(f"TTS error (tts/echo): {tts_err}")
            return jsonify({
                'audioUrl': fallback_audio_url(),
                'transcript': transcription_text,
                'llm_text': llm_text,
                'error': 'TTS failed; served fallback audio'
            }), 500

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg conversion error (tts/echo): {e.stderr.decode() if e.stderr else e}")
        return jsonify({'audioUrl': fallback_audio_url(), 'error': 'Audio conversion failed'}), 500

    except Exception as e:
        logger.error(f"Processing error (tts/echo): {e}")
        return jsonify({'audioUrl': fallback_audio_url(), 'error': str(e)}), 500

    finally:
        cleanup_files(webm_path, wav_path)


@app.route('/agent/chat/<session_id>', methods=['POST'])
def agent_chat(session_id):
    """
    Chat with memory endpoint:
    audio -> STT -> append user turn to CHAT_STORE -> LLM (with recent history) ->
    append assistant turn -> TTS -> return audioUrl + transcript + llm_text.
    Robust error handling: any failure results in fallback TTS/audio being returned
    along with an 'error' field in the JSON.
    """
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    if not audio_file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    webm_path = wav_path = None
    try:
        filename = secure_filename(audio_file.filename)
        webm_path = UPLOAD_DIR / f"temp_{int(time.time())}_{filename}"
        audio_file.save(webm_path)

        wav_path = webm_path.with_suffix('.wav')
        conversion_command = [
            "ffmpeg", "-y",
            "-i", str(webm_path),
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            "-q:a", "0",
            "-af", "volume=1.5",
            str(wav_path)
        ]
        subprocess.run(conversion_command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        try:
            if not AIAI_API_KEY:
                raise Exception("AssemblyAI key not configured")
            config = aai.TranscriptionConfig(
                speech_model=aai.SpeechModel.best,
                language_detection=True
            )
            transcriber = aai.Transcriber(config=config)
            transcript = transcriber.transcribe(str(wav_path))
            if transcript.status == "error":
                raise Exception(getattr(transcript, "error", "Unknown transcription error"))
            transcription_text = (transcript.text or "").strip()
        except Exception as stt_err:
            logger.error(f"[{session_id}] STT failed: {stt_err}")
            return jsonify({'audioUrl': fallback_audio_url(), 'error': 'Speech recognition failed'}), 500

        if not transcription_text:
            return jsonify({'error': 'No speech detected in audio'}), 400

        logger.info(f"[{session_id}] Transcribed text: {transcription_text[:200]}")

        history = CHAT_STORE.get(session_id, [])
        history.append({"role": "user", "text": transcription_text})
        CHAT_STORE[session_id] = history

        max_turns = 10
        relevant = history[-max_turns:]
        conv_lines = []
        for turn in relevant:
            role = "User" if turn["role"] == "user" else "Assistant"
            text = turn["text"].replace("\n", " ")
            conv_lines.append(f"{role}: {text}")
        conv_lines.append("Assistant:")
        conversation_prompt = "\n".join(conv_lines)

        logger.info(f"[{session_id}] Sending prompt to LLM (approx {len(conversation_prompt)} chars)")

        try:
            if not gemini_model:
                raise Exception("Gemini model not configured")
            llm_response = gemini_model.generate_content(conversation_prompt)
            llm_text = (llm_response.text or "").strip()
            if not llm_text:
                raise Exception("LLM returned empty response")
        except Exception as llm_err:
            logger.error(f"[{session_id}] LLM error: {llm_err}")
            llm_text = FALLBACK_TEXT

        history.append({"role": "assistant", "text": llm_text})
        CHAT_STORE[session_id] = history

        try:
            if not client:
                raise Exception("Murf client not configured")
            murf_audio = client.text_to_speech.generate(text=llm_text[:1000], voice_id="en-IN-isha")
            audio_url = murf_audio.audio_file
            if not audio_url:
                raise Exception("Murf returned no audio URL")
        except Exception as tts_err:
            logger.error(f"[{session_id}] TTS error: {tts_err}")
            audio_url = fallback_audio_url()

        return jsonify({
            'audioUrl': audio_url,
            'transcript': transcription_text,
            'llm_text': llm_text,
            'history_len': len(history)
        })

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg conversion error: {e.stderr.decode() if e.stderr else e}")
        return jsonify({'audioUrl': fallback_audio_url(), 'error': 'Audio conversion failed'}), 500

    except Exception as e:
        logger.error(f"Agent processing error: {e}")
        return jsonify({'audioUrl': fallback_audio_url(), 'error': str(e)}), 500

    finally:
        cleanup_files(webm_path, wav_path)


@app.route('/agent/history/<session_id>', methods=['GET'])
def get_history(session_id):
    history = CHAT_STORE.get(session_id, [])
    return jsonify({'session_id': session_id, 'history': history, 'history_len': len(history)})


@app.errorhandler(Exception)
def handle_error(error):
    logger.error(f"Unhandled error: {error}")
    return jsonify({'audioUrl': fallback_audio_url(), 'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

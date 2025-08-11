from flask import Flask, send_from_directory, request, jsonify
from murf import Murf
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import assemblyai as aai
from tempfile import NamedTemporaryFile
import subprocess
import os
import requests
import json
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

if not all([API_KEY, AIAI_API_KEY, GEMINI_API_KEY]):
    missing_keys = []
    if not API_KEY: missing_keys.append("API_KEY")
    if not AIAI_API_KEY: missing_keys.append("AI_API")
    if not GEMINI_API_KEY: missing_keys.append("GEMINI_API_KEY")
    error_msg = f"Missing required API keys: {', '.join(missing_keys)}"
    logger.error(error_msg)
    raise ValueError(error_msg)

app = Flask(__name__, static_folder='../client')
client = Murf(api_key=API_KEY)
aai.settings.api_key = AIAI_API_KEY
genai.configure(api_key=GEMINI_API_KEY)
gemini_model = genai.GenerativeModel('gemini-1.5-flash')

CHAT_STORE = {}  # session_id -> list of {"role": "user"/"assistant", "text": "..."}

UPLOAD_DIR = Path("temp_uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

def cleanup_files(*files):
    """Safely clean up temporary files"""
    for file in files:
        try:
            if file and Path(file).exists():
                Path(file).unlink()
        except Exception as e:
            logger.warning(f"Failed to delete temporary file {file}: {e}")

@app.route('/')
def home():
    return send_from_directory('../client', 'index.html')

@app.route('/index.js')
def serve_js():
    return send_from_directory('../client', 'index.js')

@app.route('/speak', methods=['POST'])
def speak():
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400

        text = data['text'].strip()
        if not text:
            return jsonify({'error': 'Empty text provided'}), 400

        logger.info(f"Generating speech for text: {text[:100]}...")
        audio_res = client.text_to_speech.generate(
            text=text,
            voice_id="en-IN-isha"
        )
        return jsonify({'audioUrl': audio_res.audio_file})

    except Exception as e:
        logger.error(f"Speech generation error: {str(e)}")
        return jsonify({'error': f'Speech generation failed: {str(e)}'}), 500

@app.route('/tts/echo', methods=['POST'])
def process_audio():
    """
    Backwards-compatible endpoint. Previously used for Echo Bot v3.
    Keeps behavior for reference; does not use chat history.
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

        subprocess.run(conversion_command,
                      check=True,
                      stdout=subprocess.PIPE,
                      stderr=subprocess.PIPE)

        config = aai.TranscriptionConfig(
            speech_model=aai.SpeechModel.best,
            language_detection=True
        )
        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(str(wav_path))

        if transcript.status == "error":
            raise Exception(f"Transcription failed: {getattr(transcript, 'error', 'Unknown error')}")

        transcription_text = (transcript.text or "").strip()
        if not transcription_text:
            return jsonify({'error': 'No speech detected in audio'}), 400

        logger.info(f"Transcribed text: {transcription_text[:100]}...")

        llm_response = gemini_model.generate_content(transcription_text)
        llm_text = (llm_response.text or "").strip()

        if not llm_text:
            return jsonify({'error': 'Failed to generate response'}), 500

        murf_audio = client.text_to_speech.generate(
            text=llm_text[:1000],
            voice_id="en-IN-isha"
        )

        return jsonify({
            'audioUrl': murf_audio.audio_file,
            'transcript': transcription_text,
            'llm_text': llm_text
        })

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg conversion error: {e.stderr.decode() if e.stderr else str(e)}")
        return jsonify({'error': 'Audio conversion failed'}), 500

    except Exception as e:
        logger.error(f"Processing error: {str(e)}")
        return jsonify({'error': str(e)}), 500

    finally:
        cleanup_files(webm_path, wav_path)


@app.route('/agent/chat/<session_id>', methods=['POST'])
def agent_chat(session_id):
    """
    New endpoint for chat-based voice agent.
    Flow:
      - Accept audio file (same as /tts/echo)
      - Convert to wav with ffmpeg
      - Transcribe via AssemblyAI
      - Append user transcript to CHAT_STORE[session_id]
      - Build conversation string from previous messages + new user message
      - Send to Gemini LLM (single-text prompt made from conversation)
      - Save assistant response to chat history
      - Generate TTS via Murf for assistant response
      - Return audioUrl, transcript, llm_text (assistant reply) and history length
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

        subprocess.run(conversion_command,
                      check=True,
                      stdout=subprocess.PIPE,
                      stderr=subprocess.PIPE)

        config = aai.TranscriptionConfig(
            speech_model=aai.SpeechModel.best,
            language_detection=True
        )
        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(str(wav_path))

        if transcript.status == "error":
            raise Exception(f"Transcription failed: {getattr(transcript, 'error', 'Unknown error')}")

        transcription_text = (transcript.text or "").strip()
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

        llm_response = gemini_model.generate_content(conversation_prompt)
        llm_text = (llm_response.text or "").strip()

        if not llm_text:
            raise Exception("LLM returned empty response")

        logger.info(f"[{session_id}] LLM response length: {len(llm_text)}")

        history.append({"role": "assistant", "text": llm_text})
        CHAT_STORE[session_id] = history

        murf_audio = client.text_to_speech.generate(
            text=llm_text[:1000],
            voice_id="en-IN-isha"
        )

        return jsonify({
            'audioUrl': murf_audio.audio_file,
            'transcript': transcription_text,
            'llm_text': llm_text,
            'history_len': len(history)
        })

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg conversion error: {e.stderr.decode() if e.stderr else str(e)}")
        return jsonify({'error': 'Audio conversion failed'}), 500

    except Exception as e:
        logger.error(f"Agent processing error: {str(e)}")
        return jsonify({'error': str(e)},), 500

    finally:
        cleanup_files(webm_path, wav_path)


@app.route('/agent/history/<session_id>', methods=['GET'])
def get_history(session_id):
    """
    Optional helper endpoint: retrieve chat history for a session.
    """
    history = CHAT_STORE.get(session_id, [])
    return jsonify({'session_id': session_id, 'history': history, 'history_len': len(history)})

@app.errorhandler(Exception)
def handle_error(error):
    logger.error(f"Unhandled error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

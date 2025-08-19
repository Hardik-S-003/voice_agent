import os
import sys
import time
import subprocess
import logging
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import assemblyai as aai
import google.generativeai as genai
from dotenv import load_dotenv
import json
import asyncio
import threading
import queue
import wave

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key')

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

PROJECT_ROOT = Path(__file__).parent.parent
UPLOAD_DIR = PROJECT_ROOT / "uploads"
UPLOADS_SERVE_DIR = UPLOAD_DIR
UPLOAD_DIR.mkdir(exist_ok=True)

MURF_API_KEY = os.getenv('MURF_API_KEY')
AIAI_API_KEY = os.getenv('ASSEMBLYAI_API_KEY')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

client = None
if MURF_API_KEY:
    try:
        client = MurfAPI(api_key=MURF_API_KEY)
    except Exception as e:
        logger.warning(f"Failed to initialize Murf client: {e}")

aai.settings.api_key = AIAI_API_KEY

gemini_model = None
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_model = genai.GenerativeModel('gemini-1.5-flash')
    except Exception as e:
        logger.warning(f"Failed to initialize Gemini model: {e}")

FALLBACK_TEXT = "I apologize, but I'm having trouble processing your request right now. Please try again."

CHAT_STORE = {}

# Real-time transcription data store
TRANSCRIPTION_SESSIONS = {}

class AudioStreamManager:
    def __init__(self, session_id):
        self.session_id = session_id
        self.audio_queue = queue.Queue()
        self.transcriber = None
        self.is_active = False
        self.audio_file = None
        self.current_transcript = ""
        self.turn_ended = False
        
    def start_transcription(self):
        """Start real-time transcription with AssemblyAI"""
        try:
            config = aai.TranscriptionConfig(
                speech_model=aai.SpeechModel.best,
                language_detection=True,
                end_utterance_silence_threshold=700,
                word_level_confidence=True
            )
            
            self.transcriber = aai.RealtimeTranscriber(
                sample_rate=16000,
                config=config,
                on_data=self._on_data,
                on_error=self._on_error,
                on_open=self._on_open,
                on_close=self._on_close,
            )
            
            self.transcriber.connect()
            self.is_active = True
            logger.info(f"[{self.session_id}] Started real-time transcription")
            
        except Exception as e:
            logger.error(f"[{self.session_id}] Failed to start transcription: {e}")
            
    def _on_open(self, session_opened: aai.RealtimeSessionOpened):
        logger.info(f"[{self.session_id}] Transcription session opened: {session_opened.session_id}")
        
    def _on_data(self, transcript: aai.RealtimeTranscript):
        if not transcript.text:
            return
            
        logger.info(f"[{self.session_id}] Transcript: {transcript.text}")
        
        # Send partial transcript to client
        socketio.emit('partial_transcript', {
            'text': transcript.text,
            'is_final': transcript.message_type == 'FinalTranscript',
            'session_id': self.session_id
        })
        
        # Handle final transcript
        if transcript.message_type == 'FinalTranscript':
            self.current_transcript += transcript.text + " "
            
            # Check for turn detection (end of utterance)
            if hasattr(transcript, 'words') and len(transcript.words) > 0:
                last_word = transcript.words[-1]
                # Simple turn detection based on silence
                current_time = time.time()
                if not hasattr(self, 'last_word_time'):
                    self.last_word_time = current_time
                
                if current_time - self.last_word_time > 1.5:  # 1.5 second silence
                    self._handle_turn_end()
                
                self.last_word_time = current_time
                
    def _on_error(self, error: aai.RealtimeError):
        logger.error(f"[{self.session_id}] Transcription error: {error}")
        
    def _on_close(self):
        logger.info(f"[{self.session_id}] Transcription session closed")
        self.is_active = False
        
    def _handle_turn_end(self):
        """Handle end of user turn"""
        if self.turn_ended or not self.current_transcript.strip():
            return
            
        self.turn_ended = True
        final_text = self.current_transcript.strip()
        
        logger.info(f"[{self.session_id}] Turn ended. Final transcript: {final_text}")
        
        # Send turn end signal to client
        socketio.emit('turn_ended', {
            'final_transcript': final_text,
            'session_id': self.session_id
        })
        
        # Process with LLM and generate response
        self._process_final_transcript(final_text)
        
    def _process_final_transcript(self, final_text):
        """Process final transcript with LLM and generate response"""
        try:
            # Update chat history
            history = CHAT_STORE.get(self.session_id, [])
            history.append({"role": "user", "text": final_text})
            CHAT_STORE[self.session_id] = history
            
            # Generate LLM response
            max_turns = 10
            relevant = history[-max_turns:]
            conv_lines = []
            for turn in relevant:
                role = "User" if turn["role"] == "user" else "Assistant"
                text = turn["text"].replace("\n", " ")
                conv_lines.append(f"{role}: {text}")
            conv_lines.append("Assistant:")
            conversation_prompt = "\n".join(conv_lines)
            
            # Get LLM response
            try:
                if not gemini_model:
                    raise Exception("Gemini model not configured")
                llm_response = gemini_model.generate_content(conversation_prompt)
                llm_text = (llm_response.text or "").strip()
                if not llm_text:
                    raise Exception("LLM returned empty response")
            except Exception as llm_err:
                logger.error(f"[{self.session_id}] LLM error: {llm_err}")
                llm_text = FALLBACK_TEXT
                
            # Update chat history with assistant response
            history.append({"role": "assistant", "text": llm_text})
            CHAT_STORE[self.session_id] = history
            
            # Generate TTS
            try:
                if not client:
                    raise Exception("Murf client not configured")
                murf_audio = client.text_to_speech.generate(text=llm_text[:1000], voice_id="en-IN-isha")
                audio_url = murf_audio.audio_file
            except Exception as tts_err:
                logger.error(f"[{self.session_id}] TTS error: {tts_err}")
                audio_url = fallback_audio_url()
                
            # Send complete response to client
            socketio.emit('agent_response', {
                'transcript': final_text,
                'llm_text': llm_text,
                'audioUrl': audio_url,
                'session_id': self.session_id
            })
            
        except Exception as e:
            logger.error(f"[{self.session_id}] Error processing final transcript: {e}")
            
    def add_audio_data(self, audio_data):
        """Add audio data to the stream"""
        if self.is_active and self.transcriber:
            try:
                # Convert webm audio data to PCM if needed
                pcm_data = self._convert_to_pcm(audio_data)
                if pcm_data:
                    self.transcriber.stream(pcm_data)
            except Exception as e:
                logger.error(f"[{self.session_id}] Error streaming audio: {e}")
                
    def _convert_to_pcm(self, webm_data):
        """Convert WebM audio data to PCM 16kHz mono"""
        try:
            # Save temporary webm file
            temp_webm = UPLOAD_DIR / f"temp_stream_{self.session_id}_{int(time.time())}.webm"
            with open(temp_webm, 'wb') as f:
                f.write(webm_data)
                
            # Convert to PCM using FFmpeg
            temp_wav = temp_webm.with_suffix('.wav')
            conversion_command = [
                "ffmpeg", "-y",
                "-i", str(temp_webm),
                "-ar", "16000",
                "-ac", "1",
                "-f", "wav",
                str(temp_wav)
            ]
            
            result = subprocess.run(conversion_command, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"FFmpeg error: {result.stderr}")
                return None
                
            # Read PCM data
            with wave.open(str(temp_wav), 'rb') as wav_file:
                pcm_data = wav_file.readframes(-1)
                
            # Cleanup temp files
            if temp_webm.exists():
                temp_webm.unlink()
            if temp_wav.exists():
                temp_wav.unlink()
                
            return pcm_data
            
        except Exception as e:
            logger.error(f"Error converting audio to PCM: {e}")
            return None
            
    def stop(self):
        """Stop the audio stream manager"""
        self.is_active = False
        if self.transcriber:
            try:
                self.transcriber.close()
            except:
                pass
        if self.audio_file:
            try:
                self.audio_file.close()
            except:
                pass


def fallback_audio_url():
    fallback_path = UPLOAD_DIR / "fallback.mp3"
    return f"/uploads/fallback.mp3" if fallback_path.exists() else ""

def ensure_fallback_audio():
    fallback_path = UPLOAD_DIR / "fallback.mp3"
    if fallback_path.exists():
        return True
    
    try:
        if not client:
            return False
        audio_res = client.text_to_speech.generate(text=FALLBACK_TEXT, voice_id="en-IN-isha")
        if hasattr(audio_res, 'audio_file') and audio_res.audio_file:
            return True
    except Exception as e:
        logger.warning(f"Failed to generate fallback audio via Murf: {e}")
        return False

def cleanup_files(*file_paths):
    for path in file_paths:
        if path and Path(path).exists():
            try:
                Path(path).unlink()
            except Exception as e:
                logger.warning(f"Failed to delete {path}: {e}")

try:
    ensure_fallback_audio()
except Exception as e:
    logger.warning(f"ensure_fallback_audio() raised an exception: {e}")

# WebSocket Events
@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    emit('connection_established', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
    # Clean up any active transcription sessions
    if request.sid in TRANSCRIPTION_SESSIONS:
        TRANSCRIPTION_SESSIONS[request.sid].stop()
        del TRANSCRIPTION_SESSIONS[request.sid]

@socketio.on('test_message')
def handle_test_message(data):
    """Handle test messages for Day 15 functionality"""
    logger.info(f"Received test message: {data}")
    emit('echo_message', {'original': data, 'echo': f"Echo: {data.get('message', 'No message')}"})

@socketio.on('start_streaming')
def handle_start_streaming(data):
    """Start streaming session"""
    session_id = data.get('session_id')
    if not session_id:
        emit('error', {'message': 'No session_id provided'})
        return
        
    logger.info(f"Starting streaming session: {session_id}")
    
    # Create new audio stream manager
    stream_manager = AudioStreamManager(session_id)
    TRANSCRIPTION_SESSIONS[request.sid] = stream_manager
    
    # Start transcription
    stream_manager.start_transcription()
    
    emit('streaming_started', {'session_id': session_id, 'status': 'active'})

@socketio.on('audio_data')
def handle_audio_data(data):
    """Handle streaming audio data"""
    if request.sid not in TRANSCRIPTION_SESSIONS:
        emit('error', {'message': 'No active streaming session'})
        return
        
    audio_data = data.get('audio')
    if not audio_data:
        return
        
    # Convert base64 to bytes if needed
    if isinstance(audio_data, str):
        import base64
        try:
            audio_data = base64.b64decode(audio_data)
        except:
            logger.error("Failed to decode base64 audio data")
            return
            
    # Add to stream manager
    stream_manager = TRANSCRIPTION_SESSIONS[request.sid]
    stream_manager.add_audio_data(audio_data)

@socketio.on('stop_streaming')
def handle_stop_streaming(data):
    """Stop streaming session"""
    if request.sid in TRANSCRIPTION_SESSIONS:
        TRANSCRIPTION_SESSIONS[request.sid].stop()
        del TRANSCRIPTION_SESSIONS[request.sid]
        
    emit('streaming_stopped', {'status': 'stopped'})

@socketio.on('reset_turn')
def handle_reset_turn(data):
    """Reset current turn for new input"""
    if request.sid in TRANSCRIPTION_SESSIONS:
        stream_manager = TRANSCRIPTION_SESSIONS[request.sid]
        stream_manager.current_transcript = ""
        stream_manager.turn_ended = False

# REST API Routes (keeping existing functionality)
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
    Chat with memory endpoint (REST API - kept for backward compatibility)
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
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
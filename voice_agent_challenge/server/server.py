from flask import Flask, send_from_directory, request, jsonify
from murf import Murf
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import assemblyai as aai
from tempfile import NamedTemporaryFile
import subprocess
import os

load_dotenv()
API_KEY = os.getenv("API_KEY")
AIAI_API_KEY = os.getenv("AI_API")

app = Flask(__name__, static_folder='../client')
client = Murf(api_key=API_KEY)
aai.settings.api_key = AIAI_API_KEY

@app.route('/')
def home():
    return send_from_directory('../client', 'index.html')

@app.route('/index.js')
def serve_js():
    return send_from_directory('../client', 'index.js')

@app.route('/speak', methods=['POST'])
def speak():
    data = request.get_json()
    text = data.get('text')

    if not text:
        return jsonify({'error': 'Please enter some text'}), 400

    try:
        audio_res = client.text_to_speech.generate(
            text=text,
            voice_id="en-IN-isha",
        )
        return jsonify({'audioUrl': audio_res.audio_file})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/upload-audio', methods=['POST'])
def upload_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    filename = secure_filename(file.filename)
    size_bytes = len(file.read())
    file.seek(0)

    def format_size(bytes):
        for unit in ['B', 'KB', 'MB', 'GB']:
            if bytes < 1024:
                return f"{bytes:.2f} {unit}"
            bytes /= 1024
        return f"{bytes:.2f} TB"

    return jsonify({
        'filename': filename,
        'content_type': file.content_type,
        'size_readable': format_size(size_bytes)
    }), 200

@app.route('/tts/echo', methods=['POST'])
def echo_tts():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']

    with NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        audio_file.save(temp_audio.name)
        webm_path = temp_audio.name

    wav_path = webm_path.replace(".webm", ".wav")

    try:
        subprocess.run([
            "ffmpeg", "-i", webm_path,
            "-ar", "16000", "-ac", "1",
            "-f", "wav", wav_path,
            "-y"
        ], check=True)

        config = aai.TranscriptionConfig(speech_model=aai.SpeechModel.best)
        transcript = aai.Transcriber(config=config).transcribe(wav_path)

        if transcript.status == "error":
            raise RuntimeError(f"Transcription failed: {transcript.error}")

        transcription_text = transcript.text.strip()
        if not transcription_text:
            return jsonify({'error': 'No speech detected in audio'}), 400

        murf_audio = client.text_to_speech.generate(
            text=transcription_text,
            voice_id="en-IN-isha"
        )

        return jsonify({'audioUrl': murf_audio.audio_file})
    except subprocess.CalledProcessError:
        return jsonify({'error': 'Audio conversion failed using ffmpeg'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.remove(webm_path)
        if os.path.exists(wav_path):
            os.remove(wav_path)

if __name__ == '__main__':
    app.run(debug=True)

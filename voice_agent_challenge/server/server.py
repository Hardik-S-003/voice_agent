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
import google.generativeai as genai
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel('gemini-1.5-flash')

load_dotenv()
API_KEY = os.getenv("API_KEY")         
AIAI_API_KEY = os.getenv("AI_API")     
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")  

if not API_KEY or not AIAI_API_KEY or not GEMINI_API_KEY:
    print("Warning: One or more API keys missing in .env (API_KEY, AI_API, GEMINI_API_KEY)")

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
        audio_res = client.text_to_speech.generate(text=text, voice_id="en-IN-isha")
        return jsonify({'audioUrl': audio_res.audio_file})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/llm/query', methods=['POST'])
def llm_query():
    """
    Accepts a file field named 'audio' (WebM from browser).
    Steps:
      1) save temp webm -> convert to wav via ffmpeg (16k mono)
      2) transcribe using AssemblyAI
      3) send transcript to Google AI Studio (Gemini/text-bison style) to get response
      4) send response to Murf TTS -> return audio URL to client
    """
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    if audio_file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400

    filename = secure_filename(audio_file.filename)

    with NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        audio_file.save(temp_audio.name)
        webm_path = temp_audio.name

    wav_path = webm_path.replace(".webm", ".wav")

    try:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", webm_path,
            "-ar", "16000", "-ac", "1",
            "-c:a", "pcm_s16le",
            wav_path
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        try:
            config = aai.TranscriptionConfig(speech_model=aai.SpeechModel.best)
            transcriber = aai.Transcriber(config=config)
            transcript = transcriber.transcribe(wav_path)
        except Exception as e:
            return jsonify({'error': 'AssemblyAI transcription error', 'details': str(e)}), 500

        if transcript.status == "error":
            return jsonify({'error': 'Transcription failed', 'details': getattr(transcript, 'error', None)}), 500

        transcription_text = (transcript.text or "").strip()
        if not transcription_text:
            return jsonify({'error': 'No speech detected in audio'}), 400

        print(f"[LLM QUERY] Transcript: {transcription_text}")
        try:
            llm_response = gemini_model.generate_content(transcription_text)
            llm_text = (llm_response.text or "").strip()
        except Exception as e:
            return jsonify({'error': 'LLM request failed', 'details': str(e)}), 500

        if isinstance(llm_json, dict):
            if "candidates" in llm_json and isinstance(llm_json["candidates"], list) and len(llm_json["candidates"]) > 0:
                llm_text = llm_json["candidates"][0].get("output", "") or llm_json["candidates"][0].get("content", "")
            if not llm_text:
                if "output" in llm_json:
                    llm_text = llm_json["output"]
                elif "content" in llm_json:
                    llm_text = llm_json["content"]

        llm_text = (llm_text or "").strip()
        if not llm_text:
            llm_text = str(llm_json)[:1000]

        print(f"[LLM QUERY] LLM text length: {len(llm_text)}")

        try:
            murf_audio = client.text_to_speech.generate(
                text=llm_text,
                voice_id="en-IN-isha"
            )
        except Exception as e:
            return jsonify({'error': 'Murf TTS generation failed', 'details': str(e)}), 500

        return jsonify({'audioUrl': murf_audio.audio_file, 'transcript': transcription_text, 'llm_text': llm_text})

    except subprocess.CalledProcessError:
        return jsonify({'error': 'Audio conversion failed (ffmpeg)'}), 500
    except Exception as e:
        return jsonify({'error': 'Unexpected server error', 'details': str(e)}), 500
    finally:
        try:
            if os.path.exists(webm_path):
                os.remove(webm_path)
            if os.path.exists(wav_path):
                os.remove(wav_path)
        except Exception:
            pass


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

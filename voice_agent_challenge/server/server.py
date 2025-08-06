from flask import Flask, send_from_directory, request, jsonify
from murf import Murf
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import os

load_dotenv()
API_KEY = os.getenv("API_KEY")

app = Flask(__name__, static_folder='../client')

UPLOAD_FOLDER = './uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Murf API 
client = Murf(api_key=API_KEY)

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
        return jsonify({'error': 'This is not a text, please enter some text'}), 400

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
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    size_bytes = os.path.getsize(filepath)

    def format_size(bytes):
        for unit in ['B', 'KB', 'MB', 'GB']:
            if bytes < 1024:
                return f"{bytes:.2f} {unit}"
            bytes /= 1024
        return f"{bytes:.2f} TB"
        
    return jsonify({
        'filename': filename,
        'content_type': file.content_type,
        'size_bytes': size_bytes,
        'size_readable': format_size(size_bytes)
    }), 200


if __name__ == '__main__':
    app.run(debug=True)

from flask import Flask, send_from_directory, request, jsonify
from murf import Murf
from dotenv import load_dotenv
import os

load_dotenv() 
API_KEY = os.getenv("API_KEY")

app = Flask(__name__, static_folder='../client')

client = Murf(api_key = API_KEY)  

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

if __name__ == '__main__':
    app.run(debug=True)

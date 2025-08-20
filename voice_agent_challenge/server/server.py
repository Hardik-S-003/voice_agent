import os
import json
import time
import wave
import io
import audioop
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import assemblyai as aai
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configure APIs
aai_api_key = os.getenv("ASSEMBLYAI_API_KEY")
gemini_api_key = os.getenv("GEMINI_API_KEY")

if aai_api_key:
    aai.settings.api_key = aai_api_key
    print("AssemblyAI API key loaded successfully")
else:
    print("Warning: ASSEMBLYAI_API_KEY not found in environment variables")

if gemini_api_key:
    genai.configure(api_key=gemini_api_key)
    print("Gemini API key loaded successfully")
else:
    print("Warning: GEMINI_API_KEY not found in environment variables")

# Initialize Gemini model if API key is available
model = None
if gemini_api_key:
    try:
        # List available models to find the correct one
        print("Available Gemini models:")
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(f"  - {m.name}")
        
        # Try to use the correct model name
        try:
            # Try the newer model name first
            model = genai.GenerativeModel('gemini-1.0-pro')
            print("Using gemini-1.0-pro model")
        except Exception as e:
            print(f"Error with gemini-1.0-pro: {e}")
            try:
                # Fallback to the older model name
                model = genai.GenerativeModel('gemini-pro')
                print("Using gemini-pro model")
            except Exception as e2:
                print(f"Error with gemini-pro: {e2}")
                model = None
                
    except Exception as e:
        print(f"Error listing models: {e}")
        model = None

# Store conversation history per session
conversations = {}

# Serve the main UI page
@app.route('/')
def serve_ui():
    try:
        # Go up one level from server to client folder
        return send_from_directory('../client', 'index.html')
    except Exception as e:
        return f"Error loading UI: {str(e)}", 500

# Serve static files (JS, CSS, etc.)
@app.route('/<path:path>')
def serve_static(path):
    try:
        return send_from_directory('../client', path)
    except Exception as e:
        return f"Error loading file {path}: {str(e)}", 404

@app.route('/api/transcribe', methods=['POST'])
def transcribe_audio():
    try:
        # Check if audio file is in the request
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        # Get session ID from headers or create a new one
        session_id = request.headers.get('X-Session-ID', f"session_{int(time.time())}")
        
        audio_file = request.files['audio']
        
        # Check if the file is empty
        if audio_file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        # Save the file
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"audio_{session_id}_{timestamp}.wav"
        filepath = os.path.join('uploads', filename)
        
        # Create uploads directory if it doesn't exist
        if not os.path.exists('uploads'):
            os.makedirs('uploads')
        
        # Read the audio data
        audio_data = audio_file.read()
        
        # Save the original file
        with open(filepath, 'wb') as f:
            f.write(audio_data)
        
        print(f"Audio file saved: {filename}")
        
        # Initialize session conversation if needed
        if session_id not in conversations:
            conversations[session_id] = []
        
        # Try to transcribe with AssemblyAI if API key is available
        transcription = ""
        if aai_api_key:
            try:
                # For newer versions of AssemblyAI, we need to use the config properly
                # First let's check what version we're using and adjust accordingly
                
                # Method 1: Try without sample_rate first (newer versions)
                try:
                    config = aai.TranscriptionConfig()
                    transcriber = aai.Transcriber()
                    transcript = transcriber.transcribe(filepath, config=config)
                except TypeError as e:
                    # If that fails, try the older method with sample_rate
                    print("Trying older AssemblyAI API format...")
                    # For some versions, we might need to use different approach
                    transcript = aai.Transcriber().transcribe(filepath)
                
                if transcript.status == aai.TranscriptStatus.error:
                    print(f"AssemblyAI transcription error: {transcript.error}")
                    transcription = "Could not transcribe audio. Please try again."
                else:
                    transcription = transcript.text
                    print(f"AssemblyAI transcription: {transcription}")
                    
            except Exception as e:
                print(f"Error with AssemblyAI transcription: {e}")
                # Fallback: try direct API call
                try:
                    transcription = try_direct_assemblyai_api(filepath)
                except Exception as e2:
                    print(f"Direct API also failed: {e2}")
                    transcription = "Error transcribing audio with AssemblyAI."
        else:
            # Fallback simulated transcription
            transcription = "Hello! This is a simulated transcription of your audio input."
        
        # Add to conversation history
        conversations[session_id].append({"role": "user", "content": transcription})
        
        # Get response from Gemini if available, otherwise use a simulated response
        ai_response = ""
        if model:
            try:
                # Get response from Gemini
                conversation_history = "\n".join(
                    [f"{msg['role']}: {msg['content']}" for msg in conversations[session_id]]
                )
                
                prompt = f"Continue this conversation naturally as an AI assistant:\n{conversation_history}\nassistant:"
                
                response = model.generate_content(prompt)
                ai_response = response.text
                
            except Exception as e:
                print(f"Error calling Gemini API: {e}")
                # Try to see what models are available
                try:
                    print("Available models for generateContent:")
                    for m in genai.list_models():
                        if 'generateContent' in m.supported_generation_methods:
                            print(f"  - {m.name}")
                except Exception as e2:
                    print(f"Error listing models: {e2}")
                
                ai_response = "I'm having trouble connecting to the AI service right now. Please check your API keys."
        else:
            # Simulated response if Gemini is not available
            ai_response = "Hello! I'm your AI assistant. I received your audio message. Please make sure your Gemini API key is properly configured."
        
        # Add AI response to conversation history
        conversations[session_id].append({"role": "assistant", "content": ai_response})
        
        return jsonify({
            'transcription': transcription,
            'response': ai_response,
            'session_id': session_id
        })
        
    except Exception as e:
        print(f"Error in transcribe endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def try_direct_assemblyai_api(filepath):
    """Try direct HTTP API call to AssemblyAI as fallback"""
    import requests
    
    headers = {
        'authorization': aai_api_key,
        'content-type': 'application/json'
    }
    
    # First upload the file
    with open(filepath, 'rb') as f:
        response = requests.post(
            'https://api.assemblyai.com/v2/upload',
            headers=headers,
            data=f.read()
        )
    upload_url = response.json()['upload_url']
    
    # Then request transcription
    transcript_request = {
        'audio_url': upload_url,
        'language_code': 'en'
    }
    
    transcript_response = requests.post(
        'https://api.assemblyai.com/v2/transcript',
        json=transcript_request,
        headers=headers
    )
    
    transcript_id = transcript_response.json()['id']
    
    # Poll for results
    polling_endpoint = f"https://api.assemblyai.com/v2/transcript/{transcript_id}"
    
    while True:
        transcription_result = requests.get(polling_endpoint, headers=headers).json()
        
        if transcription_result['status'] == 'completed':
            return transcription_result['text']
        elif transcription_result['status'] == 'error':
            raise Exception(f"Transcription failed: {transcription_result['error']}")
        else:
            time.sleep(3)

@app.route('/api/start_session', methods=['POST'])
def start_session():
    """Start a new conversation session"""
    try:
        session_id = f"session_{int(time.time())}"
        conversations[session_id] = []
        return jsonify({'session_id': session_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/clear_session', methods=['POST'])
def clear_session():
    """Clear conversation history for a session"""
    try:
        session_id = request.json.get('session_id')
        if session_id and session_id in conversations:
            conversations[session_id] = []
            return jsonify({'status': 'success'})
        return jsonify({'error': 'Invalid session ID'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    # Check what Gemini models are available
    available_models = []
    if gemini_api_key:
        try:
            for m in genai.list_models():
                if 'generateContent' in m.supported_generation_methods:
                    available_models.append(m.name)
        except Exception as e:
            available_models = [f"Error: {str(e)}"]
    
    return jsonify({
        'status': 'ok',
        'assemblyai_configured': aai_api_key is not None,
        'gemini_configured': gemini_api_key is not None,
        'gemini_model_ready': model is not None,
        'available_gemini_models': available_models
    })

if __name__ == '__main__':
    # Create uploads directory if it doesn't exist
    if not os.path.exists('uploads'):
        os.makedirs('uploads')
    
    print("Starting server...")
    print("Visit http://localhost:5000 to access the application")
    
    # Start Flask app
    app.run(debug=True, port=5000, host='0.0.0.0')
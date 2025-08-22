import os
import json
import time
import base64
import asyncio
import websockets
import threading
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
murf_api_key = os.getenv("MURF_API_KEY")

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

if murf_api_key:
    print("Murf API key loaded successfully")
else:
    print("Warning: MURF_API_KEY not found in environment variables")

# Initialize Gemini model if API key is available
model = None
if gemini_api_key:
    try:
        # Try to use the correct model name
        try:
            model = genai.GenerativeModel('gemini-pro')
            print("Using gemini-pro model")
        except Exception as e:
            print(f"Error with gemini-pro: {e}")
            try:
                model = genai.GenerativeModel('gemini-1.0-pro')
                print("Using gemini-1.0-pro model")
            except Exception as e2:
                print(f"Error with gemini-1.0-pro: {e2}")
                model = None
    except Exception as e:
        print(f"Error initializing Gemini model: {e}")
        model = None

# Store conversation history per session
conversations = {}

# WebSocket connections
murf_ws_connection = None
client_connections = set()  # Store all connected clients
murf_context_id = "voice_agent_context_001"  # Static context ID

async def handle_client_connection(websocket, path):
    """Handle incoming client WebSocket connections"""
    client_id = id(websocket)
    client_connections.add(websocket)
    print(f"Client connected: {client_id}")
    
    try:
        await websocket.send(json.dumps({
            "type": "status",
            "message": "Connected to voice agent server"
        }))
        
        # Keep connection alive
        async for message in websocket:
            try:
                data = json.loads(message)
                if data.get("type") == "audio_received":
                    print(f"Client {client_id} acknowledged audio data reception")
                    print(f"Audio chunk size: {len(data.get('chunk_id', 'unknown'))}")
            except json.JSONDecodeError:
                print(f"Invalid JSON from client {client_id}")
                
    except websockets.exceptions.ConnectionClosed:
        print(f"Client {client_id} disconnected")
    finally:
        client_connections.discard(websocket)

async def broadcast_to_clients(message):
    """Send message to all connected clients"""
    if not client_connections:
        return
        
    disconnected_clients = set()
    
    for client in client_connections:
        try:
            await client.send(message)
        except websockets.exceptions.ConnectionClosed:
            disconnected_clients.add(client)
        except Exception as e:
            print(f"Error sending to client: {e}")
            disconnected_clients.add(client)
    
    # Remove disconnected clients
    for client in disconnected_clients:
        client_connections.discard(client)

async def connect_to_murf():
    """Connect to Murf.ai WebSocket API and stream audio to clients"""
    global murf_ws_connection
    
    if not murf_api_key:
        print("Murf API key not available, skipping WebSocket connection")
        return
    
    try:
        # Murf.ai WebSocket endpoint
        murf_ws_url = "wss://api.murf.ai/v1/speech/ws"
        
        # Connect to Murf WebSocket
        murf_ws_connection = await websockets.connect(
            murf_ws_url,
            extra_headers={"Authorization": f"Bearer {murf_api_key}"}
        )
        print("Connected to Murf.ai WebSocket API")
        
        # Send initialization message with static context ID
        init_message = {
            "type": "init",
            "context_id": murf_context_id,
            "voice_id": "en-US-1",  # Default voice, you can change this
            "sample_rate": 24000,
            "format": "mp3"
        }
        await murf_ws_connection.send(json.dumps(init_message))
        
        # Keep connection alive and stream audio to clients
        chunk_count = 0
        while True:
            try:
                message = await murf_ws_connection.recv()
                data = json.loads(message)
                
                if data.get("type") == "audio":
                    # Received audio data from Murf
                    chunk_count += 1
                    audio_base64 = data.get("data")
                    
                    # Print to console (first 100 chars for brevity)
                    print("=" * 80)
                    print(f"MURF.AI AUDIO CHUNK {chunk_count} (first 100 chars):")
                    print(audio_base64[:100] + "...")
                    print("=" * 80)
                    
                    # Send audio chunk to all connected clients
                    audio_message = {
                        "type": "audio_chunk",
                        "chunk_id": f"chunk_{chunk_count}",
                        "data": audio_base64,
                        "timestamp": datetime.now().isoformat()
                    }
                    
                    await broadcast_to_clients(json.dumps(audio_message))
                    print(f"Sent audio chunk {chunk_count} to {len(client_connections)} clients")
                    
            except websockets.exceptions.ConnectionClosed:
                print("Murf WebSocket connection closed")
                break
            except Exception as e:
                print(f"Error in Murf WebSocket: {e}")
                break
                
    except Exception as e:
        print(f"Failed to connect to Murf WebSocket: {e}")

async def send_text_to_murf(text):
    """Send text to Murf.ai for speech synthesis"""
    global murf_ws_connection
    
    if not murf_ws_connection or not murf_api_key:
        print("Murf WebSocket not available")
        return
    
    try:
        # Send text to Murf
        text_message = {
            "type": "text",
            "text": text,
            "context_id": murf_context_id
        }
        await murf_ws_connection.send(json.dumps(text_message))
        print(f"Sent text to Murf: {text[:50]}...")
        
    except Exception as e:
        print(f"Error sending text to Murf: {e}")

def start_client_websocket():
    """Start client WebSocket server"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    start_server = websockets.serve(handle_client_connection, "0.0.0.0", 8765)
    loop.run_until_complete(start_server)
    print("Client WebSocket server started on port 8765")
    loop.run_forever()

def start_murf_websocket():
    """Start Murf WebSocket connection"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(connect_to_murf())

# Serve the main UI page
@app.route('/')
def serve_ui():
    try:
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
        
        # For now, simulate transcription
        simulated_transcription = "Hello! This is a test transcription of your audio input."
        
        # Add to conversation history
        conversations[session_id].append({"role": "user", "content": simulated_transcription})
        
        # Get response from Gemini if available, otherwise use a simulated response
        ai_response = ""
        if model:
            try:
                # Get response from Gemini
                conversation_history = "\n".join(
                    [f"{msg['role']}: {msg['content']}" for msg in conversations[session_id]]
                )
                
                prompt = f"Continue this conversation naturally as an AI assistant. Keep response under 100 words:\n{conversation_history}\nassistant:"
                
                response = model.generate_content(prompt)
                ai_response = response.text
                
            except Exception as e:
                print(f"Error calling Gemini API: {e}")
                ai_response = "I'm having trouble connecting to the AI service right now."
        else:
            # Simulated response if Gemini is not available
            ai_response = "Hello! I'm your AI assistant. I received your audio message."
        
        # Add AI response to conversation history
        conversations[session_id].append({"role": "assistant", "content": ai_response})
        
        # Send AI response to Murf for TTS (in background)
        if murf_api_key and ai_response:
            try:
                # Run in background thread to avoid blocking the response
                threading.Thread(
                    target=lambda: asyncio.run(send_text_to_murf(ai_response)),
                    daemon=True
                ).start()
            except Exception as e:
                print(f"Error sending to Murf: {e}")
        
        return jsonify({
            'transcription': simulated_transcription,
            'response': ai_response,
            'session_id': session_id
        })
        
    except Exception as e:
        print(f"Error in transcribe endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

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
    return jsonify({
        'status': 'ok',
        'assemblyai_configured': aai_api_key is not None,
        'gemini_configured': gemini_api_key is not None,
        'murf_configured': murf_api_key is not None,
        'gemini_model_ready': model is not None,
        'connected_clients': len(client_connections)
    })

if __name__ == '__main__':
    # Create uploads directory if it doesn't exist
    if not os.path.exists('uploads'):
        os.makedirs('uploads')
    
    print("Starting server...")
    print("Visit http://localhost:5000 to access the application")
    
    # Start client WebSocket server in background thread
    client_ws_thread = threading.Thread(target=start_client_websocket, daemon=True)
    client_ws_thread.start()
    print("Client WebSocket server started on port 8765")
    
    # Start Murf WebSocket connection in background thread
    if murf_api_key:
        murf_thread = threading.Thread(target=start_murf_websocket, daemon=True)
        murf_thread.start()
        print("Murf WebSocket connection started in background")
    else:
        print("Murf API key not found, skipping WebSocket connection")
    
    if __name__ == "__main__":
        app.run(debug=True, port=5000, host='0.0.0.0', use_reloader=False)
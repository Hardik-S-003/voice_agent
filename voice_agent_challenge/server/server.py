from flask import Flask, send_from_directory

app = Flask(__name__, static_folder='../client')

@app.route('/')
def home():
    return send_from_directory('../client', 'index.html')

@app.route('/index.js')
def serve_js():
    return send_from_directory('../client', 'index.js')

if __name__ == '__main__':
    app.run(debug=True)

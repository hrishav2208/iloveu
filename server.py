import os
import sqlite3
import random
import string
from flask import Flask, request, jsonify, send_from_directory, Response
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='.', static_url_path='')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 # 50 MB max
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# ─── CORS Headers ─────────────────────────────────────────────────────────────
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

# ─── Database (safe init — preserves existing data) ───────────────────────────
def init_db():
    conn = sqlite3.connect('database.sqlite')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS shares (
            id TEXT PRIMARY KEY,
            images TEXT,
            target_name TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def generate_share_id(length=6):
    characters = string.ascii_letters + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

# ─── Favicon ──────────────────────────────────────────────────────────────────
FAVICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text y=".9em" font-size="90">💜</text>
</svg>'''

@app.route('/favicon.ico')
def favicon():
    return Response(FAVICON_SVG, mimetype='image/svg+xml')

@app.route('/favicon.svg')
def favicon_svg():
    return Response(FAVICON_SVG, mimetype='image/svg+xml')

# ─── Main page ────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# ─── Upload photos ────────────────────────────────────────────────────────────
@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'photos' not in request.files:
        return jsonify({'error': 'No photos provided'}), 400

    files = request.files.getlist('photos')
    saved_filenames = []

    for file in files:
        if file.filename == '':
            continue
        filename        = secure_filename(file.filename)
        unique_filename = f"{generate_share_id(4)}_{filename}"
        filepath        = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(filepath)
        saved_filenames.append(unique_filename)

    if not saved_filenames:
        return jsonify({'error': 'No valid files uploaded'}), 400

    share_id    = generate_share_id()
    images_str  = ','.join(saved_filenames)
    target_name = request.form.get('target_name', '')

    conn = sqlite3.connect('database.sqlite')
    c = conn.cursor()
    c.execute('INSERT INTO shares (id, images, target_name) VALUES (?, ?, ?)',
              (share_id, images_str, target_name))
    conn.commit()
    conn.close()

    return jsonify({'share_id': share_id, 'message': 'Upload successful'})

# ─── Get share ────────────────────────────────────────────────────────────────
@app.route('/api/share/<share_id>', methods=['GET'])
def get_share(share_id):
    conn = sqlite3.connect('database.sqlite')
    c = conn.cursor()
    c.execute('SELECT images, target_name FROM shares WHERE id = ?', (share_id,))
    row = c.fetchone()
    conn.close()

    if row:
        images      = row[0].split(',')
        target_name = row[1]
        image_urls  = [f"/uploads/{img}" for img in images]
        return jsonify({'images': image_urls, 'target_name': target_name})
    else:
        return jsonify({'error': 'Share not found'}), 404

# ─── Serve uploads ────────────────────────────────────────────────────────────
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ─── Boot ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Holographic Theater Server on http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)

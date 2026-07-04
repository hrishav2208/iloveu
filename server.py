import os
import sqlite3
import random
import string
from flask import Flask, request, jsonify, send_from_directory, Response
from werkzeug.utils import secure_filename

# Optional Supabase import
try:
    from supabase import create_client, Client
except ImportError:
    create_client = None

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

# ─── Supabase Initialization ──────────────────────────────────────────────────
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')
supabase_client = None

if create_client and SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("Connected to Supabase successfully!")
    except Exception as e:
        print("Failed to initialize Supabase client:", e)
else:
    print("Supabase credentials not set or package missing. Falling back to local SQLite & Disk storage.")

# ─── Local Database fallback (safe init) ──────────────────────────────────────
def init_local_db():
    if not supabase_client:
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

init_local_db()

def generate_share_id(length=6):
    characters = string.ascii_letters + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

# ─── Favicon ──────────────────────────────────────────────────────────────────
FAVICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text y=".9em" font-size="90">🌹</text>
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
    share_id = generate_share_id()
    target_name = request.form.get('target_name', '')
    
    saved_images = []

    if supabase_client:
        # Supabase deployment path
        for file in files:
            if file.filename == '':
                continue
            filename = secure_filename(file.filename)
            unique_filename = f"{generate_share_id(4)}_{filename}"
            
            # File path in Supabase bucket
            bucket_filepath = f"{share_id}/{unique_filename}"
            file_bytes = file.read()
            
            try:
                # Upload to 'photos' bucket
                supabase_client.storage.from_('photos').upload(
                    path=bucket_filepath,
                    file=file_bytes,
                    file_options={"content-type": file.content_type or "image/jpeg"}
                )
                
                # Fetch public URL
                public_url_obj = supabase_client.storage.from_('photos').get_public_url(bucket_filepath)
                # handle if public_url_obj is string or object with public_url attr
                public_url = getattr(public_url_obj, 'public_url', str(public_url_obj))
                saved_images.append(public_url)
            except Exception as e:
                print(f"Failed to upload {filename} to Supabase:", e)

        if not saved_images:
            return jsonify({'error': 'Failed to upload any files to Supabase'}), 500

        # Save share link metadata to Supabase DB table
        try:
            images_str = ','.join(saved_images)
            supabase_client.table('shares').insert({
                'id': share_id,
                'images': images_str,
                'target_name': target_name
            }).execute()
        except Exception as e:
            print("Failed to save share metadata in Supabase DB:", e)
            return jsonify({'error': 'Failed to save share metadata'}), 500
            
    else:
        # Local SQLite and Disk fallback
        for file in files:
            if file.filename == '':
                continue
            filename        = secure_filename(file.filename)
            unique_filename = f"{generate_share_id(4)}_{filename}"
            filepath        = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(filepath)
            saved_images.append(unique_filename)

        if not saved_images:
            return jsonify({'error': 'No valid files uploaded'}), 400

        images_str = ','.join(saved_images)
        
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
    if supabase_client:
        try:
            res = supabase_client.table('shares').select('images, target_name').eq('id', share_id).execute()
            rows = getattr(res, 'data', [])
            if rows:
                images = rows[0]['images'].split(',')
                target_name = rows[0]['target_name']
                return jsonify({'images': images, 'target_name': target_name})
            else:
                return jsonify({'error': 'Share not found in Supabase'}), 404
        except Exception as e:
            print("Failed to select share from Supabase:", e)
            return jsonify({'error': 'Supabase query failed'}), 500
    else:
        # Local SQLite fallback
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
            return jsonify({'error': 'Share not found locally'}), 404

# ─── Serve uploads (only used in local fallback mode) ─────────────────────────
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ─── Boot ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Holographic Theater Server on http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)

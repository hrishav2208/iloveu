@echo off
echo Installing requirements...
pip install -r requirements.txt
echo Starting Holographic Theater Server...
start "" http://localhost:5000
python server.py
pause

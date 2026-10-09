@echo off
cd /d "%~dp0"
set STREAMLIT_SERVER_PORT=8502
set STREAMLIT_SERVER_ADDRESS=localhost
set STREAMLIT_BROWSER_SERVER_ADDRESS=localhost
echo.
echo Starting from folder: %cd%
echo Open this in your browser: http://localhost:8502
echo.
python -m streamlit run app.py --server.port 8502 --server.address localhost
pause
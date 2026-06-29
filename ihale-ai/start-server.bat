@echo off
REM ihale-AI FastAPI sunucusu — ikikat.net entegrasyonu
REM Bu dosyaya çift tıklayarak Python API'yi başlatın.

cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo HATA: .venv bulunamadi. Once: python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

echo.
echo ========================================
echo   IHALE-AI API SUNUCUSU
echo ========================================
echo.
echo URL:        http://localhost:8000
echo API docs:   http://localhost:8000/docs
echo.
echo Bu pencereyi acik tutun. Kapatirsaniz API durur.
echo ikikat.net dashboard'da "Ihale" sekmesinden kullanin.
echo.
echo CTRL+C ile sunucuyu durdurabilirsiniz.
echo ========================================
echo.

.venv\Scripts\python.exe -m uvicorn api.server:app --host 0.0.0.0 --port 8000

pause

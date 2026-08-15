import os
from dotenv import load_dotenv

load_dotenv()

# API Keys para proveedores de IA
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Proveedor de IA por defecto ('gemini' o 'openai')
DEFAULT_AI_PROVIDER = os.getenv("DEFAULT_AI_PROVIDER", "gemini")

# Telegram Bot Token (para aprobaciones de Ads y alertas)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Configuración del servidor
PORT = int(os.getenv("AGENT_PORT", 8000))
HOST = os.getenv("AGENT_HOST", "0.0.0.0")

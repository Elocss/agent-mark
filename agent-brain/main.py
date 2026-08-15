from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import config

app = FastAPI(title="Mark Agent Brain API", description="Servidor de IA y Agentes para Mark Growth Agent")

class ChatMessage(BaseModel):
    sender: str  # 'user' o 'bot'
    message: str
    timestamp: Optional[str] = None

class ChatRequest(BaseModel):
    client_id: str
    client_name: str
    bot_name: str
    ai_instructions: str
    lead_phone: str
    lead_name: Optional[str] = None
    chat_history: List[ChatMessage]
    current_message: str

class AdRequest(BaseModel):
    client_id: str
    client_name: str
    niche: str
    offer_details: str
    budget_suggested: float

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Mark Agent Brain (IA)",
        "provider_configured": {
            "gemini": bool(config.GEMINI_API_KEY),
            "openai": bool(config.OPENAI_API_KEY)
        }
    }

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Recibe el mensaje actual, el historial y las instrucciones de IA del cliente,
    procesa la respuesta utilizando Gemini o OpenAI, y retorna la respuesta redactada.
    """
    try:
        # Aquí implementaremos el motor de IA en la Fase 3
        # Por ahora simulamos una respuesta simple
        simulated_response = f"Hola, soy {request.bot_name} de {request.client_name}. ¿Cómo puedo ayudarte hoy con tu consulta de {request.current_message}?"
        return {"response": simulated_response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-ad")
async def generate_ad_endpoint(request: AdRequest):
    """
    Genera propuestas de textos publicitarios, audiencias y presupuestos usando IA.
    """
    try:
        # Aquí implementaremos el generador de Ads de IA en la Fase 3
        return {
            "ad_copy": f"¡Gran Oferta en {request.client_name}! {request.offer_details}. Haz clic para chatear con nosotros.",
            "target_radius_km": 5.0,
            "budget": request.budget_suggested
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)

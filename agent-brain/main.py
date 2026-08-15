from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn
import config
from agents.chat_agent import generate_chat_response
from agents.ad_agent import generate_ad_proposal

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
    products: Optional[List[Dict[str, Any]]] = None

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
        },
        "default_provider": config.DEFAULT_AI_PROVIDER
    }

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Recibe el mensaje actual, el historial y las instrucciones de IA del cliente,
    procesa la respuesta utilizando Gemini o OpenAI, y retorna la respuesta redactada.
    """
    try:
        # Convertir el historial de mensajes Pydantic a lista de diccionarios
        history = [
            {"sender": msg.sender, "message": msg.message}
            for msg in request.chat_history
        ]
        
        # Llamar al agente conversacional
        clean_response, action, action_data = generate_chat_response(
            ai_instructions=request.ai_instructions,
            chat_history=history,
            current_message=request.current_message,
            products=request.products
        )
        
        return {
            "response": clean_response,
            "action": action,
            "action_data": action_data
        }
    except Exception as e:
        print(f"Error en chat_endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-ad")
async def generate_ad_endpoint(request: AdRequest):
    """
    Genera propuestas de textos publicitarios, audiencias y presupuestos usando IA.
    """
    try:
        proposal = generate_ad_proposal(
            client_name=request.client_name,
            niche=request.niche,
            offer_details=request.offer_details,
            budget_suggested=request.budget_suggested
        )
        return proposal
    except Exception as e:
        print(f"Error en generate_ad_endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)

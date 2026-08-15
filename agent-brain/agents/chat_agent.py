import google.generativeai as genai
from openai import OpenAI
import config
import re
from typing import List, Dict, Any, Tuple

# Inicializar clientes de API
if config.GEMINI_API_KEY:
    genai.configure(api_key=config.GEMINI_API_KEY)

openai_client = OpenAI(api_key=config.OPENAI_API_KEY) if config.OPENAI_API_KEY else None

def generate_chat_response(
    ai_instructions: str,
    chat_history: List[Dict[str, str]],
    current_message: str,
    products: List[Dict[str, Any]] = None
) -> Tuple[str, str | None, Dict[str, Any] | None]:
    """
    Genera la respuesta del bot utilizando Gemini o OpenAI.
    Detecta si la IA desea ejecutar la acción de cobro (Mercado Pago).
    Retorna: (texto_limpio, accion, datos_accion)
    """
    products = products or []
    
    # 1. Estructurar la lista de productos en texto para el prompt
    products_text = ""
    for idx, prod in enumerate(products, 1):
        products_text += f"- {idx}. {prod.get('name')}: ${prod.get('price')} {prod.get('currency')} (Ref ID: {prod.get('id')}) - Desc: {prod.get('description', '')}\n"
    
    # 2. Definir instrucciones de sistema
    system_prompt = f"""
{ai_instructions}

---
PRODUCTOS DISPONIBLES PARA LA VENTA:
{products_text if products_text else "No hay productos específicos configurados en el catálogo."}

INSTRUCCIONES CRÍTICAS DE CONVERSIÓN Y PAGO:
- Tu objetivo es ayudar al usuario y llevarlo hacia la compra.
- Si el usuario dice explícitamente que QUIERE COMPRAR, ADQUIRIR o CONTRATAR uno de los productos de la lista anterior, y te dice que pagará con TARJETA, debes indicarle que le generarás el link de pago.
- Al final de tu respuesta (en la misma última línea, sin espacios extras), debes insertar exactamente el siguiente comando oculto:
  [ACTION:SEND_PAYMENT_LINK|Nombre del Producto|Precio]
  Donde "Nombre del Producto" debe ser el nombre del producto de la lista, y "Precio" debe ser el número entero sin símbolos.
  Ejemplo: "Excelente. Aquí tienes tu link para la membresía mensual: [ACTION:SEND_PAYMENT_LINK|Membresía Mensual|5000]"
- Si prefiere pagar por transferencia o efectivo, NO agregues el comando, solo explícale los datos bancarios del local o indícale cómo proceder.
- No inventes productos que no estén en la lista. Si el usuario te pregunta por algo no listado, dile que consultarás con un asesor humano.
"""

    # 3. Formatear el historial de chat para los LLMs
    # Para Gemini o OpenAI, construimos el prompt conversacional
    formatted_prompt = []
    
    # Agregar mensajes previos
    for msg in chat_history:
        role = "user" if msg["sender"] == "user" else "assistant"
        formatted_prompt.append({"role": role, "content": msg["message"]})
        
    # Agregar el mensaje actual del usuario
    formatted_prompt.append({"role": "user", "content": current_message})

    raw_response = ""

    # 4. Consultar el proveedor de IA configurado
    if config.DEFAULT_AI_PROVIDER == "openai" and openai_client:
        try:
            messages = [{"role": "system", "content": system_prompt}] + formatted_prompt
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.7
            )
            raw_response = response.choices[0].message.content or ""
        except Exception as e:
            print(f"Error en OpenAI API: {e}")
            # Fallback a Gemini si falla
            raw_response = _call_gemini_fallback(system_prompt, formatted_prompt)
    else:
        # Por defecto usar Gemini
        raw_response = _call_gemini_fallback(system_prompt, formatted_prompt)

    # 5. Parsear el comando de acción si existe en el texto de respuesta de la IA
    # Formato buscado: [ACTION:SEND_PAYMENT_LINK|Membresía Mensual|5000]
    action_match = re.search(r'\[ACTION:SEND_PAYMENT_LINK\|([^|]+)\|(\d+)\]', raw_response)
    
    action: str | None = None
    action_data: Dict[str, Any] | None = None
    clean_response = raw_response

    if action_match:
        product_name = action_match.group(1).strip()
        price = int(action_match.group(2).strip())
        
        action = "send_payment_link"
        action_data = {
            "product_name": product_name,
            "price": price
        }
        
        # Limpiar el token de acción del mensaje que se le enviará al usuario
        clean_response = raw_response.replace(action_match.group(0), "").strip()

    return clean_response, action, action_data

def _call_gemini_fallback(system_prompt: str, formatted_prompt: List[Dict[str, str]]) -> str:
    if not config.GEMINI_API_KEY:
        return "Disculpa, el servicio de Inteligencia Artificial no está configurado correctamente."
    
    try:
        # Usar gemini-1.5-flash para respuestas rápidas y de bajo costo
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=system_prompt
        )
        
        # Convertir formato de chat a formato compatible con Gemini (parts/role)
        contents = []
        for msg in formatted_prompt:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({
                "role": role,
                "parts": [{"text": msg["content"]}]
            })
            
        response = model.generate_content(contents)
        return response.text or ""
    except Exception as e:
        print(f"Error en Gemini API: {e}")
        return "Disculpa la molestia, tengo dificultades técnicas para procesar tu respuesta en este momento."

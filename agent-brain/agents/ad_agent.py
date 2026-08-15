import google.generativeai as genai
from openai import OpenAI
import config
from typing import Dict, Any

openai_client = OpenAI(api_key=config.OPENAI_API_KEY) if config.OPENAI_API_KEY else None

def generate_ad_proposal(
    client_name: str,
    niche: str,
    offer_details: str,
    budget_suggested: float
) -> Dict[str, Any]:
    """
    Genera propuestas publicitarias diarias optimizadas para Meta Ads usando IA.
    """
    system_prompt = """
Eres Mark, un Agente de Growth e Ingeniería de IA experto en Meta Ads para negocios locales.
Tu objetivo es redactar textos publicitarios de alto rendimiento (conversión y CTR) y definir la segmentación óptima.
"""

    prompt = f"""
Genera una propuesta publicitaria para el siguiente cliente:
- Negocio Comercial: {client_name}
- Nicho/Sector: {niche}
- Oferta / Promoción del día: {offer_details}
- Presupuesto sugerido por día: ${budget_suggested} USD

Debes proveer:
1. Copys Publicitarios: Genera 2 variantes creativas de copys para Facebook/Instagram (una corta enfocada a beneficio inmediato, una larga enfocada a historia/dolor). Agrega emojis apropiados y llamadas a la acción que inviten a chatear por WhatsApp.
2. Segmentación Recomendada para Meta Ads: Intereses y comportamientos clave recomendados para segmentar a la redonda del local comercial.
3. Radio de Geofencing: Radio recomendado en km (ej. 3km o 5km) según el nicho.

Responde de forma clara y estructurada en formato JSON plano con las siguientes llaves exactas:
- copy_variante_a: texto
- copy_variante_b: texto
- segmentacion_intereses: texto explicativo de intereses recomendados
- radio_sugerido_km: número
- presupuesto_diario_usd: número
"""

    raw_response = ""

    # Usar OpenAI si está configurado como principal
    if config.DEFAULT_AI_PROVIDER == "openai" and openai_client:
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.8
            )
            raw_response = response.choices[0].message.content or ""
        except Exception as e:
            print(f"Error en OpenAI Ad Generation: {e}")
            raw_response = _call_gemini_ad(system_prompt, prompt)
    else:
        raw_response = _call_gemini_ad(system_prompt, prompt)

    # Limpiar y parsear JSON de respuesta
    try:
        import json
        # Buscar el bloque JSON si hay texto adicional
        json_clean = raw_response.strip()
        if "```json" in json_clean:
            json_clean = json_clean.split("```json")[1].split("```")[0].strip()
        elif "```" in json_clean:
            json_clean = json_clean.split("```")[1].split("```")[0].strip()
            
        data = json.loads(json_clean)
        return data
    except Exception as e:
        print(f"Error parseando respuesta de Ads de la IA: {e}. Respuesta cruda: {raw_response}")
        # Retorno de fallback estructurado
        return {
            "copy_variante_a": f"¡Gran promoción en {client_name}! Aprovecha hoy: {offer_details}. Escríbenos por WhatsApp y reserva tu cupo.",
            "copy_variante_b": f"¿Buscas {niche} en tu zona? En {client_name} tenemos la solución ideal para ti: {offer_details}. Haz clic y chatea con nosotros en tiempo real.",
            "segmentacion_intereses": "Público general interesado en el sector.",
            "radio_sugerido_km": 5.0,
            "presupuesto_diario_usd": budget_suggested
        }

def _call_gemini_ad(system_prompt: str, prompt: str) -> str:
    if not config.GEMINI_API_KEY:
        return "{}"
    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=system_prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        response = model.generate_content(prompt)
        return response.text or "{}"
    except Exception as e:
        print(f"Error en Gemini Ad Generation: {e}")
        return "{}"

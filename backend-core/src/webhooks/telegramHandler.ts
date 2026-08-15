import { answerTelegramCallback, updateTelegramMessageStatus } from '../services/telegram';
import { getDatabase } from '../services/db';

/**
 * Procesa las solicitudes entrantes de la API de webhooks de Telegram (interacción con botones).
 */
export async function handleIncomingTelegramWebhook(payload: any): Promise<void> {
  const callbackQuery = payload.callback_query;
  
  if (!callbackQuery) {
    return; // No es un evento de callback de botón
  }

  const callbackQueryId = callbackQuery.id;
  const message = callbackQuery.message;
  const messageId = message.message_id;
  const chatId = message.chat.id;
  const originalText = message.text || '';
  const operatorName = callbackQuery.from?.first_name || 'Operador';
  
  let actionData;
  try {
    actionData = JSON.parse(callbackQuery.data);
  } catch (err) {
    console.error('Error parseando callback data de Telegram:', callbackQuery.data);
    await answerTelegramCallback(callbackQueryId, 'Error en el comando.');
    return;
  }

  const { act, cid } = actionData;
  const db = await getDatabase();

  // Buscar cliente en la base de datos para confirmar que existe
  const client = await db.get('SELECT * FROM clients WHERE client_id = ?', [cid]);
  if (!client) {
    await answerTelegramCallback(callbackQueryId, 'Error: Cliente no encontrado.');
    return;
  }

  if (act === 'ap_a' || act === 'ap_b') {
    const variantName = act === 'ap_a' ? 'Variante A (Corta)' : 'Variante B (Larga)';
    console.log(`Lanzando campaña de anuncios en Meta para el cliente: ${client.client_name}. Variante elegida: ${variantName}`);
    
    // Aquí se ejecutaría la llamada a la API de Meta Ads Graph
    // MOCK: Simulamos el lanzamiento exitoso
    await mockLaunchMetaCampaign(client.client_id, variantName);

    // Responder visualmente al chat de Telegram
    await answerTelegramCallback(callbackQueryId, '¡Anuncio aprobado y publicado!');
    await updateTelegramMessageStatus(
      chatId,
      messageId,
      originalText,
      `✅ Anuncio aprobado por ${operatorName}. *[Variante ${act === 'ap_a' ? 'A' : 'B'} publicada en Meta Ads]*`
    );
  } else if (act === 'rej') {
    console.log(`Campaña de anuncios diario RECHAZADA para el cliente: ${client.client_name}`);
    
    await answerTelegramCallback(callbackQueryId, 'Anuncio rechazado.');
    await updateTelegramMessageStatus(
      chatId,
      messageId,
      originalText,
      `❌ Rechazado por ${operatorName}. No se publicará publicidad hoy.`
    );
  }
}

/**
 * Función simulada para representar el lanzamiento de anuncios en la API de Meta.
 */
async function mockLaunchMetaCampaign(clientId: string, variant: string) {
  // En producción, esto hace un POST a /v19.0/act_<AD_ACCOUNT_ID>/campaigns
  return new Promise((resolve) => {
    console.log(`[Meta Ads API] Campaña creada con éxito para ${clientId}. Creativo: ${variant}`);
    setTimeout(resolve, 500);
  });
}

import axios from 'axios';

/**
 * Servicio para interactuar con la API de Bots de Telegram.
 */
export async function sendAdProposalToTelegram(
  clientId: string,
  clientName: string,
  adProposal: {
    copy_variante_a: string;
    copy_variante_b: string;
    segmentacion_intereses: string;
    radio_sugerido_km: number;
    presupuesto_diario_usd: number;
  }
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('ADVERTENCIA: TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados. Omitiendo envío de propuesta a Telegram.');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const messageText = `📢 *PROPUESTA DE ANUNCIO DIARIO*
*Cliente:* ${clientName} (\`${clientId}\`)
*Presupuesto sugerido:* $${adProposal.presupuesto_diario_usd} USD/día
*Radio de cobertura:* ${adProposal.radio_sugerido_km} km

📝 *Variante A (Corta):*
"${adProposal.copy_variante_a}"

📝 *Variante B (Larga/Historia):*
"${adProposal.copy_variante_b}"

🎯 *Segmentación sugerida:*
_${adProposal.segmentacion_intereses}_`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '✅ Aprobar Variante A',
          callback_data: JSON.stringify({ act: 'ap_a', cid: clientId })
        },
        {
          text: '✅ Aprobar Variante B',
          callback_data: JSON.stringify({ act: 'ap_b', cid: clientId })
        }
      ],
      [
        {
          text: '❌ Rechazar Todo',
          callback_data: JSON.stringify({ act: 'rej', cid: clientId })
        }
      ]
    ]
  };

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    console.log(`Propuesta de anuncio para ${clientName} enviada a Telegram.`);
  } catch (error: any) {
    console.error('Error enviando propuesta a Telegram:', error.response?.data || error.message);
  }
}

/**
 * Responde a un callback query de Telegram (clic en botón) para dar feedback visual al operador.
 */
export async function answerTelegramCallback(callbackQueryId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  try {
    await axios.post(url, {
      callback_query_id: callbackQueryId,
      text: text
    });
  } catch (error) {
    console.error('Error al responder callback de Telegram:', error);
  }
}

/**
 * Edita el mensaje original de Telegram para deshabilitar los botones e indicar el estado final.
 */
export async function updateTelegramMessageStatus(
  chatId: number,
  messageId: number,
  originalText: string,
  statusText: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      message_id: messageId,
      text: `${originalText}\n\n🛑 *ESTADO:* ${statusText}`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] } // Quita los botones
    });
  } catch (error) {
    console.error('Error al editar mensaje de Telegram:', error);
  }
}

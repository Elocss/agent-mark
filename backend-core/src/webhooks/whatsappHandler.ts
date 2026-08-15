import { getDatabase } from '../services/db';
import { sendWhatsAppMessage, sendWhatsAppPaymentLink } from '../services/whatsapp';
import { createPaymentPreference } from '../services/mercadopago';
import { addLeadToSheet } from '../services/sheets';
import axios from 'axios';

interface ChatMessage {
  sender: 'user' | 'bot';
  message: string;
}

/**
 * Manejador principal para procesar mensajes entrantes de WhatsApp.
 */
export async function handleIncomingWhatsAppMessage(payload: any): Promise<void> {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  if (!value || !value.messages || value.messages.length === 0) {
    return; // No es un mensaje entrante de interés
  }

  const phoneId = value.metadata?.phone_number_id;
  const message = value.messages[0];
  const leadPhone = message.from;
  const leadName = value.contacts?.[0]?.profile?.name || leadPhone;
  const messageText = message.text?.body || '';

  if (!messageText) {
    console.log('Mensaje recibido sin contenido de texto de:', leadPhone);
    return;
  }

  const db = await getDatabase();

  // 1. Buscar si pertenece a un cliente registrado
  const client = await db.get(
    'SELECT * FROM clients WHERE whatsapp_phone_id = ?',
    [phoneId]
  );

  if (!client) {
    console.warn(`Mensaje recibido para un número de WhatsApp no registrado en el sistema: ${phoneId}`);
    return;
  }

  console.log(`Procesando mensaje de ${leadName} (${leadPhone}) para el local ${client.client_name}`);

  // 2. Obtener o crear el lead en SQLite
  let lead = await db.get('SELECT * FROM leads WHERE lead_phone = ?', [leadPhone]);
  if (!lead) {
    await db.run(
      'INSERT INTO leads (lead_phone, client_id, name, status) VALUES (?, ?, ?, ?)',
      [leadPhone, client.client_id, leadName, 'interesado']
    );
    lead = { lead_phone: leadPhone, client_id: client.client_id, name: leadName, status: 'interesado' };

    // Sincronizar el nuevo lead al Google Sheet del cliente
    if (client.google_sheet_url) {
      addLeadToSheet(client.google_sheet_url, {
        name: leadName,
        phone: leadPhone,
        status: 'interesado',
        notes: 'Lead creado al iniciar chat por WhatsApp'
      }).catch(err => console.error('Error sincronizando lead inicial a Sheets:', err));
    }
  } else {
    // Actualizar última fecha de interacción
    await db.run(
      'UPDATE leads SET last_interaction = CURRENT_TIMESTAMP WHERE lead_phone = ?',
      [leadPhone]
    );
  }

  // 3. Registrar el mensaje entrante del usuario en la base de datos
  await db.run(
    'INSERT INTO interactions_log (lead_phone, sender, message) VALUES (?, ?, ?)',
    [leadPhone, 'user', messageText]
  );

  // 4. Obtener el historial reciente de chats (últimos 10 mensajes)
  const historyRows = await db.all(
    'SELECT sender, message FROM interactions_log WHERE lead_phone = ? ORDER BY timestamp DESC LIMIT 10',
    [leadPhone]
  );

  // Invertir historial para que quede cronológico
  const chatHistory: ChatMessage[] = historyRows
    .map(row => ({
      sender: row.sender as 'user' | 'bot',
      message: row.message
    }))
    .reverse();

  // 5. Enviar al "Cerebro del Agente" (FastAPI / Python)
  const agentUrl = process.env.AGENT_BRAIN_URL || 'http://127.0.0.1:8000';
  let botResponse = '';
  let action: string | null = null;
  let actionData: any = null;

  try {
    const aiResponse = await axios.post(`${agentUrl}/chat`, {
      client_id: client.client_id,
      client_name: client.client_name,
      bot_name: client.bot_name,
      ai_instructions: client.ai_instructions || '',
      lead_phone: leadPhone,
      lead_name: leadName,
      chat_history: chatHistory,
      current_message: messageText
    });

    botResponse = aiResponse.data.response || '';
    action = aiResponse.data.action || null;
    actionData = aiResponse.data.action_data || null;
  } catch (error: any) {
    console.error('Error al comunicarse con el Cerebro del Agente (FastAPI):', error.message);
    botResponse = `Hola. Disculpa la molestia, en este momento tengo un problema de conexión. Un asesor de ${client.client_name} se comunicará contigo a la brevedad.`;
  }

  // 6. Ejecutar acciones especiales (ej. Generar enlace de pago de Mercado Pago)
  if (action === 'send_payment_link' && actionData && client.mercado_pago_access_token) {
    try {
      console.log(`Generando link de pago dinámico para ${leadName} - ${actionData.product_name}`);
      
      const paymentUrl = await createPaymentPreference(
        client.mercado_pago_access_token,
        client.client_id,
        leadPhone,
        actionData.product_name,
        actionData.price
      );

      // Guardar transacción como pendiente
      const transactionId = paymentUrl.split('pref_id=')[1] || `tr_${Date.now()}`;
      await db.run(
        'INSERT INTO transactions (transaction_id, lead_phone, client_id, amount, payment_method, payment_status) VALUES (?, ?, ?, ?, ?, ?)',
        [transactionId, leadPhone, client.client_id, actionData.price, 'tarjeta', 'pendiente']
      );

      // Enviar enlace de pago por WhatsApp
      await sendWhatsAppPaymentLink(
        client.whatsapp_phone_id,
        client.whatsapp_access_token,
        leadPhone,
        actionData.product_name,
        paymentUrl
      );

      // Registrar la respuesta del bot en la BD
      await db.run(
        'INSERT INTO interactions_log (lead_phone, sender, message) VALUES (?, ?, ?)',
        [leadPhone, 'bot', `[Link de Pago Seguro Enviado: ${actionData.product_name}]`]
      );

      return;
    } catch (paymentError) {
      console.error('Error al procesar la acción de pago de Mercado Pago:', paymentError);
      botResponse = `Quiero facilitarte el link de pago para *${actionData.product_name}*, pero tuvimos un inconveniente al generarlo. Por favor, aguarda un momento y te lo enviaré de nuevo.`;
    }
  }

  // 7. Enviar la respuesta de texto estándar por WhatsApp
  if (botResponse) {
    await sendWhatsAppMessage(
      client.whatsapp_phone_id,
      client.whatsapp_access_token,
      leadPhone,
      botResponse
    );

    // Registrar la respuesta del bot en la BD
    await db.run(
      'INSERT INTO interactions_log (lead_phone, sender, message) VALUES (?, ?, ?)',
      [leadPhone, 'bot', botResponse]
    );
  }
}

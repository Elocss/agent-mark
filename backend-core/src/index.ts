import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getDatabase } from './services/db';
import { handleIncomingWhatsAppMessage } from './webhooks/whatsappHandler';
import { handleIncomingTelegramWebhook } from './webhooks/telegramHandler';
import { sendAdProposalToTelegram } from './services/telegram';
import { getPaymentDetails } from './services/mercadopago';
import { sendSaleNotificationEmail } from './services/email';
import { sendWhatsAppMessage } from './services/whatsapp';
import { addLeadToSheet } from './services/sheets';
import { runMonthlyReportingProcess } from './services/reports';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Endpoint base para verificar estado
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'Mark Core Backend', timestamp: new Date() });
});

// Webhook de WhatsApp: Verificación de Meta (GET) y recepción de mensajes (POST)
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'mark_secret_token';

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook de WhatsApp verificado con éxito.');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

app.post('/webhooks/whatsapp', async (req, res) => {
  try {
    const payload = req.body;
    
    // Procesar asíncronamente para responder 200 a Meta inmediatamente y evitar reintentos
    handleIncomingWhatsAppMessage(payload).catch(err => {
      console.error('Error asíncrono procesando webhook de WhatsApp:', err);
    });

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Error procesando webhook de WhatsApp:', error);
    res.status(500).send('INTERNAL_SERVER_ERROR');
  }
});

// Webhook de Mercado Pago: Recepción de IPN y estados de pago
app.post('/webhooks/mercadopago', async (req, res) => {
  try {
    const payload = req.body;
    const clientId = req.query.client_id as string;
    
    // Obtener el ID de pago de Mercado Pago
    const paymentId = payload.data?.id || payload.id;
    const action = payload.action;

    if (!clientId) {
      console.warn('Webhook de Mercado Pago recibido sin client_id en la query string.');
      return res.status(400).json({ error: 'Falta client_id en query parameters' });
    }

    // Si es solo una notificación de prueba o no contiene ID de pago, responder 200
    if (!paymentId || (action && action !== 'payment.created' && action !== 'payment.updated')) {
      console.log('Notificación de Mercado Pago ignorada (sin ID de pago o acción no relevante).');
      return res.status(200).json({ received: true });
    }

    console.log(`Procesando notificación de pago ${paymentId} para cliente: ${clientId}`);

    const db = await getDatabase();
    const client = await db.get('SELECT * FROM clients WHERE client_id = ?', [clientId]);

    if (!client) {
      console.warn(`Cliente ${clientId} no encontrado en BD para procesar pago.`);
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    if (!client.mercado_pago_access_token) {
      console.warn(`Cliente ${clientId} no tiene configurado Access Token de Mercado Pago.`);
      return res.status(400).json({ error: 'Cliente no tiene token de Mercado Pago configurado' });
    }

    // Obtener detalles completos del pago desde la API de Mercado Pago
    const paymentDetails = await getPaymentDetails(client.mercado_pago_access_token, paymentId.toString());
    const status = paymentDetails.status;
    const amount = paymentDetails.transaction_amount;
    
    // Parsear la referencia externa que contiene el teléfono y producto
    let extRef: any = {};
    try {
      extRef = JSON.parse(paymentDetails.external_reference);
    } catch (e) {
      console.warn('No se pudo parsear external_reference de Mercado Pago:', paymentDetails.external_reference);
    }

    const leadPhone = extRef.lead_phone;
    const productName = extRef.product_name || 'Servicio/Producto';

    if (!leadPhone) {
      console.warn('No se encontró el teléfono del lead en external_reference del pago.');
      return res.status(200).json({ received: true, message: 'Falta teléfono en referencia' });
    }

    if (status === 'approved') {
      // Verificar si ya fue procesada anteriormente para idempotencia
      const existingTx = await db.get(
        'SELECT * FROM transactions WHERE transaction_id = ? AND payment_status = "approved"',
        [paymentId.toString()]
      );

      if (existingTx) {
        console.log(`El pago ${paymentId} ya había sido procesado previamente.`);
        return res.status(200).json({ received: true, message: 'Pago ya procesado' });
      }

      console.log(`¡PAGO APROBADO! Registrar compra de ${leadPhone} por $${amount}. Producto: ${productName}`);

      // 1. Guardar o actualizar la transacción en SQLite local
      await db.run(`
        INSERT INTO transactions (transaction_id, lead_phone, client_id, amount, payment_method, payment_status)
        VALUES (?, ?, ?, ?, 'tarjeta', 'approved')
        ON CONFLICT(transaction_id) DO UPDATE SET payment_status = 'approved'
      `, [paymentId.toString(), leadPhone, client.client_id, amount]);

      // 2. Actualizar el estado del lead a 'comprador'
      await db.run(
        'UPDATE leads SET status = "comprador" WHERE lead_phone = ?',
        [leadPhone]
      );

      // Obtener el nombre del lead
      const lead = await db.get('SELECT name FROM leads WHERE lead_phone = ?', [leadPhone]);
      const leadName = lead?.name || 'Comprador WhatsApp';

      // 3. Sincronizar en tiempo real el nuevo estado en el Google Sheet del cliente
      if (client.google_sheet_url) {
        addLeadToSheet(client.google_sheet_url, {
          name: leadName,
          phone: leadPhone,
          status: 'comprador',
          notes: `Compra aprobada por Mercado Pago. Ref ID: ${paymentId}. Producto: ${productName}`
        }).catch(err => console.error('Error sincronizando pago aprobado a Google Sheets:', err));
      }

      // 4. Enviar correo de alerta de venta al negocio local usando Resend
      if (client.notification_email) {
        sendSaleNotificationEmail(client.notification_email, client.client_name, {
          buyerName: leadName,
          buyerPhone: leadPhone,
          productName: productName,
          price: amount,
          paymentMethod: 'tarjeta',
          transactionId: paymentId.toString()
        }).catch(err => console.error('Error enviando alerta de venta por correo:', err));
      }

      // 5. Enviar mensaje de confirmación al cliente por WhatsApp
      await sendWhatsAppMessage(
        client.whatsapp_phone_id,
        client.whatsapp_access_token,
        leadPhone,
        `🎉 ¡Pago aprobado con éxito! Se ha acreditado tu pago de *$${amount} ARS* por *${productName}*.\n\nHemos notificado al equipo de *${client.client_name}* para gestionar tu pedido/reserva. ¡Muchas gracias por tu compra!`
      );
    } else {
      console.log(`Estado del pago ${paymentId}: ${status}. No requiere acción inmediata.`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Error procesando webhook de Mercado Pago:', error.message);
    res.status(500).send('INTERNAL_SERVER_ERROR');
  }
});

// Webhook de Telegram: Recepción de interacciones de botones (POST)
app.post('/webhooks/telegram', async (req, res) => {
  try {
    const payload = req.body;
    handleIncomingTelegramWebhook(payload).catch(err => {
      console.error('Error procesando callback de Telegram:', err);
    });
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error procesando webhook de Telegram:', error);
    res.status(500).send('INTERNAL_SERVER_ERROR');
  }
});

// Endpoint de Prueba: Generar propuesta de anuncio y enviarla a Telegram para aprobación
app.get('/api/ads/generate-test', async (req, res) => {
  const { client_id, offer_details, budget } = req.query;

  if (!client_id) {
    return res.status(400).json({ error: 'Falta el parámetro client_id' });
  }

  try {
    const db = await getDatabase();
    const client = await db.get('SELECT * FROM clients WHERE client_id = ?', [client_id]);

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const agentUrl = process.env.AGENT_BRAIN_URL || 'http://127.0.0.1:8000';
    const offer = (offer_details as string) || 'Membresía anual con 20% de descuento y matrícula bonificada.';
    const dailyBudget = budget ? parseFloat(budget as string) : 5.0;

    const response = await axios.post(`${agentUrl}/generate-ad`, {
      client_id: client.client_id,
      client_name: client.client_name,
      niche: 'Negocio Local',
      offer_details: offer,
      budget_suggested: dailyBudget
    });

    const proposal = response.data;
    
    // Enviar propuesta al chat de Telegram
    await sendAdProposalToTelegram(client.client_id, client.client_name, {
      copy_variante_a: proposal.copy_variante_a,
      copy_variante_b: proposal.copy_variante_b,
      segmentacion_intereses: proposal.segmentacion_intereses,
      radio_sugerido_km: proposal.radio_sugerido_km,
      presupuesto_diario_usd: proposal.presupuesto_diario_usd
    });

    res.json({ success: true, message: 'Propuesta generada y enviada a Telegram para aprobación.', proposal });
  } catch (error: any) {
    console.error('Error generando propuesta de Ad de prueba:', error.message);
    res.status(500).json({ error: 'Error interno al generar propuesta de anuncio.', details: error.message });
  }
});

// Endpoint de Prueba: Generar informe estadístico mensual manualmente para un cliente
app.post('/api/reports/generate', async (req, res) => {
  const { client_id, year, month } = req.body;

  if (!client_id || !year || !month) {
    return res.status(400).json({ error: 'Faltan parámetros client_id, year o month' });
  }

  try {
    await runMonthlyReportingProcess(client_id as string, parseInt(year as string), parseInt(month as string));
    res.json({ success: true, message: `Reporte mensual de ${client_id} generado y enviado.` });
  } catch (error: any) {
    console.error('Error generando reporte mensual manual:', error.message);
    res.status(500).json({ error: 'Error al generar reporte mensual', details: error.message });
  }
});

// Endpoint para el Cron mensual: Generar y enviar reportes a TODOS los clientes activos
app.post('/api/reports/trigger-all', async (req, res) => {
  try {
    const db = await getDatabase();
    const clients = await db.all('SELECT client_id FROM clients');
    
    // Obtener mes y año anterior (el reporte se genera el primer día del mes sobre el mes vencido)
    const today = new Date();
    let month = today.getMonth(); // 0-indexed representa el mes anterior porque hoy es día 1 del nuevo mes
    let year = today.getFullYear();
    
    if (month === 0) {
      month = 12;
      year = year - 1;
    }

    console.log(`Cron mensual activado. Generando reportes de ${clients.length} clientes para el periodo ${year}-${month}`);

    for (const client of clients) {
      try {
        await runMonthlyReportingProcess(client.client_id, year, month);
      } catch (clientErr: any) {
        console.error(`Error generando reporte para cliente ${client.client_id}:`, clientErr.message);
      }
    }

    res.json({ success: true, message: `Procesados reportes mensuales para ${clients.length} clientes.` });
  } catch (error: any) {
    console.error('Error en trigger-all de reportes mensuales:', error.message);
    res.status(500).json({ error: 'Error al generar reportes colectivos', details: error.message });
  }
});

// Función para cargar perfiles de clientes y guardarlos en la base de datos
async function syncClientProfiles() {
  const db = await getDatabase();
  const profilesDir = path.join(__dirname, '../../clients-profiles');

  if (!fs.existsSync(profilesDir)) {
    console.log('Directorio de perfiles de clientes no encontrado, creando...');
    fs.mkdirSync(profilesDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(profilesDir);
  for (const file of files) {
    if (file.endsWith('.json') && file !== 'template.json') {
      try {
        const filePath = path.join(profilesDir, file);
        const profileContent = fs.readFileSync(filePath, 'utf-8');
        const profile = JSON.parse(profileContent);

        await db.run(`
          INSERT INTO clients (
            client_id, client_name, bot_name, whatsapp_phone_id, 
            whatsapp_access_token, mercado_pago_access_token, 
            notification_email, google_sheet_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET
            client_name = excluded.client_name,
            bot_name = excluded.bot_name,
            whatsapp_phone_id = excluded.whatsapp_phone_id,
            whatsapp_access_token = excluded.whatsapp_access_token,
            mercado_pago_access_token = excluded.mercado_pago_access_token,
            notification_email = excluded.notification_email,
            google_sheet_url = excluded.google_sheet_url
        `, [
          profile.client_id,
          profile.client_name,
          profile.bot_name,
          profile.whatsapp_phone_id,
          profile.whatsapp_access_token,
          profile.mercado_pago_access_token,
          profile.notification_email,
          profile.google_sheet_url
        ]);

        console.log(`Perfil sincronizado en BD: ${profile.client_name} (${profile.client_id})`);
      } catch (err) {
        console.error(`Error al cargar el perfil ${file}:`, err);
      }
    }
  }
}

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`Servidor principal ejecutándose en http://localhost:${PORT}`);
  try {
    await syncClientProfiles();
  } catch (dbError) {
    console.error('Error al sincronizar base de datos e iniciar:', dbError);
  }
});

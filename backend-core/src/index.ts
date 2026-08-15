import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getDatabase } from './services/db';

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
    console.log('Mensaje recibido de WhatsApp webhook:', JSON.stringify(payload, null, 2));
    
    // Aquí procesaremos el webhook en la Fase 2
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
    console.log('Notificación recibida de Mercado Pago:', JSON.stringify(payload, null, 2));

    // Aquí procesaremos la confirmación de pago en la Fase 4
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error procesando webhook de Mercado Pago:', error);
    res.status(500).send('INTERNAL_SERVER_ERROR');
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

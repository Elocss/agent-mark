import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

let dbInstance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.join(__dirname, '../../../database.db');

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await initDatabase(dbInstance);
  return dbInstance;
}

async function initDatabase(db: Database) {
  // Tabla de Clientes (configuraciones de los negocios)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      whatsapp_phone_id TEXT,
      whatsapp_access_token TEXT,
      mercado_pago_access_token TEXT,
      notification_email TEXT,
      google_sheet_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de Leads (usuarios que interactúan por WhatsApp)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      lead_phone TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'interesado', -- 'interesado', 'calificado', 'comprador'
      last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    )
  `);

  // Tabla de Historial de Chats (para buffer e IA)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS interactions_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_phone TEXT NOT NULL,
      sender TEXT NOT NULL, -- 'user' o 'bot'
      message TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_phone) REFERENCES leads(lead_phone)
    )
  `);

  // Tabla de Transacciones (pagos y reservas)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY, -- ID de Mercado Pago o generado
      lead_phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL, -- 'tarjeta' o 'transferencia'
      payment_status TEXT NOT NULL, -- 'pendiente', 'aprobado', 'rechazado'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_phone) REFERENCES leads(lead_phone),
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    )
  `);

  console.log('Base de datos SQLite inicializada correctamente.');
}

import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

// Cargamos credenciales de cuenta de servicio de Google
const CREDENTIALS_PATH = path.join(__dirname, '../../../google-credentials.json');

function getGoogleAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn('ADVERTENCIA: google-credentials.json no encontrado. Las funciones de Google Sheets estarán deshabilitadas hasta que se configure.');
    return null;
  }

  return new google.auth.JWT(
    undefined,
    CREDENTIALS_PATH,
    undefined,
    ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  );
}

/**
 * Crea una nueva hoja de cálculo para un cliente clonando una plantilla base o creando una desde cero.
 * @param clientName Nombre del cliente/negocio local
 * @returns La URL de la nueva hoja de cálculo creada
 */
export async function createClientSheet(clientName: string): Promise<string> {
  const auth = getGoogleAuthClient();
  if (!auth) {
    return 'https://docs.google.com/spreadsheets/d/CONFIGURACION_PENDIENTE';
  }

  const drive = google.drive({ version: 'v3', auth });
  const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID; // ID de la hoja plantilla

  try {
    let newFileId = '';

    if (MASTER_SHEET_ID) {
      // Clonar la hoja plantilla
      console.log(`Clonando hoja plantilla (${MASTER_SHEET_ID}) para el cliente: ${clientName}`);
      const copyResponse = await drive.files.copy({
        fileId: MASTER_SHEET_ID,
        requestBody: {
          name: `CRM Leads - ${clientName}`,
        },
      });
      newFileId = copyResponse.data.id || '';
    } else {
      // Crear una hoja nueva vacía desde cero
      console.log(`Creando hoja nueva vacía para el cliente: ${clientName}`);
      const sheets = google.sheets({ version: 'v4', auth });
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: `CRM Leads - ${clientName}`,
          },
          sheets: [
            {
              properties: {
                title: 'Leads',
              },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: [
                        { userEnteredValue: { stringValue: 'Fecha' } },
                        { userEnteredValue: { stringValue: 'Nombre' } },
                        { userEnteredValue: { stringValue: 'WhatsApp' } },
                        { userEnteredValue: { stringValue: 'Estado' } },
                        { userEnteredValue: { stringValue: 'Notas / Detalles' } }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              properties: {
                title: 'Reporte Histórico',
              },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: [
                        { userEnteredValue: { stringValue: 'Mes' } },
                        { userEnteredValue: { stringValue: 'Clics (Ads)' } },
                        { userEnteredValue: { stringValue: 'Leads Capturados' } },
                        { userEnteredValue: { stringValue: 'Mensajes Totales' } },
                        { userEnteredValue: { stringValue: 'Ventas Cerradas' } },
                        { userEnteredValue: { stringValue: 'Ingresos ($)' } },
                        { userEnteredValue: { stringValue: 'Ahorro Operativo ($)' } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
      });
      newFileId = createResponse.data.spreadsheetId || '';
    }

    if (!newFileId) {
      throw new Error('No se pudo obtener el ID del archivo creado.');
    }

    // Otorgar permisos de lectura para cualquiera con el enlace (para compartir fácil con el negocio)
    await drive.permissions.create({
      fileId: newFileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${newFileId}/edit`;
    console.log(`Hoja creada con éxito para ${clientName}: ${sheetUrl}`);
    return sheetUrl;
  } catch (error) {
    console.error('Error al crear/clonar la hoja de Google Sheets:', error);
    throw error;
  }
}

/**
 * Agrega una fila de lead a la hoja de cálculo del cliente.
 */
export async function addLeadToSheet(
  spreadsheetUrl: string,
  lead: { name: string; phone: string; status: string; notes?: string }
): Promise<void> {
  const auth = getGoogleAuthClient();
  if (!auth) {
    console.log('Sincronización con Google Sheets omitida (no configurado).');
    return;
  }

  // Extraer el ID de la URL del spreadsheet
  const match = spreadsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    console.error('URL de Google Sheet inválida:', spreadsheetUrl);
    return;
  }
  const spreadsheetId = match[1];

  const sheets = google.sheets({ version: 'v4', auth });
  const dateStr = new Date().toLocaleString('es-ES', { timeZone: 'America/Argentina/Buenos_Aires' });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Leads!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [dateStr, lead.name || 'Desconocido', lead.phone, lead.status, lead.notes || '']
        ]
      }
    });
    console.log(`Lead ${lead.phone} registrado en Google Sheet (${spreadsheetId})`);
  } catch (error) {
    console.error(`Error al agregar lead al sheet ${spreadsheetId}:`, error);
  }
}

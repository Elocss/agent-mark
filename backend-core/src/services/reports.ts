import PDFDocument from 'pdfkit';
import { getDatabase } from './db';
import { sendMonthlyReportEmail } from './email';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

// Helper de autenticación de Google
const CREDENTIALS_PATH = path.join(__dirname, '../../../google-credentials.json');
function getGoogleAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  return new google.auth.JWT(
    undefined,
    CREDENTIALS_PATH,
    undefined,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

/**
 * Proceso principal de reporte mensual: calcula métricas, genera PDF, actualiza Sheets y envía correo.
 */
export async function runMonthlyReportingProcess(
  clientId: string,
  year: number,
  month: number
): Promise<void> {
  const db = await getDatabase();
  const client = await db.get('SELECT * FROM clients WHERE client_id = ?', [clientId]);

  if (!client) {
    console.error(`Cliente ${clientId} no encontrado para generar reporte mensual.`);
    return;
  }

  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year);
  const periodStr = `${yearStr}-${monthStr}`;

  console.log(`Generando reporte mensual para ${client.client_name} - Periodo: ${periodStr}`);

  // 1. Obtener Métricas desde SQLite
  // leads creados en el mes
  const leadsRow = await db.get(
    "SELECT COUNT(*) as count FROM leads WHERE client_id = ? AND strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?",
    [clientId, yearStr, monthStr]
  );
  const leadsCount = leadsRow?.count || 0;

  // mensajes totales del bot en el mes
  const msgRow = await db.get(
    "SELECT COUNT(*) as count FROM interactions_log il JOIN leads l ON il.lead_phone = l.lead_phone WHERE l.client_id = ? AND strftime('%Y', il.timestamp) = ? AND strftime('%m', il.timestamp) = ?",
    [clientId, yearStr, monthStr]
  );
  const interactionsCount = msgRow?.count || 0;

  // ventas y monto recaudado
  const txRow = await db.get(
    "SELECT COUNT(*) as count, SUM(amount) as total FROM transactions WHERE client_id = ? AND payment_status = 'approved' AND strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?",
    [clientId, yearStr, monthStr]
  );
  const salesCount = txRow?.count || 0;
  const totalRevenue = txRow?.total || 0;

  // Estimación de Clics (Ads): Los clics suelen ser mayores a los leads que inician el chat (tasa de rebote estimada del 30%)
  const clicsEstimated = Math.round(leadsCount * 1.4);

  // Ahorro Operativo ($) y de tiempo
  // Asumimos que Mark atiende cada chat en promedio 3 minutos, y un operador cuesta $10 USD/hora.
  const minutesSaved = interactionsCount * 3;
  const hoursSaved = Math.round((minutesSaved / 60) * 10) / 10;
  const hourlyRate = 10; // USD/hora
  const operationalSavings = Math.round(hoursSaved * hourlyRate);

  const monthsMap = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthName = monthsMap[month - 1];

  // 2. Generar el archivo PDF en memoria
  const pdfBuffer = await generatePdfReport(client.client_name, monthName, yearStr, {
    clics: clicsEstimated,
    leads: leadsCount,
    messages: interactionsCount,
    sales: salesCount,
    revenue: totalRevenue,
    hoursSaved: hoursSaved,
    savings: operationalSavings
  });

  // 3. Sincronizar consolidado en Google Sheets ("Reporte Histórico")
  if (client.google_sheet_url) {
    await writeReportToGoogleSheet(client.google_sheet_url, {
      monthLabel: `${monthName} ${yearStr}`,
      clics: clicsEstimated,
      leads: leadsCount,
      messages: interactionsCount,
      sales: salesCount,
      revenue: totalRevenue,
      savings: operationalSavings
    }).catch(err => console.error('Error guardando reporte consolidado en Sheets:', err));
  }

  // 4. Enviar PDF por correo al cliente usando Resend
  if (client.notification_email) {
    await sendMonthlyReportEmail(
      client.notification_email,
      client.client_name,
      `${monthName}-${yearStr}`,
      pdfBuffer
    );
  }
}

/**
 * Genera un PDF estructurado y formal utilizando la librería PDFKit.
 */
function generatePdfReport(
  clientName: string,
  monthName: string,
  yearStr: string,
  metrics: {
    clics: number;
    leads: number;
    messages: number;
    sales: number;
    revenue: number;
    hoursSaved: number;
    savings: number;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    // Logo y Cabecera del Reporte
    doc.fillColor('#1E3A8A').fontSize(22).text('MARK - AGENTE GROWTH DE IA', { align: 'center' });
    doc.fillColor('#666666').fontSize(12).text(`Reporte Ejecutivo de Crecimiento`, { align: 'center' });
    doc.moveDown(1.5);

    // Separador
    doc.strokeColor('#E5E7EB').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1.5);

    // Información del Cliente
    doc.fillColor('#333333').fontSize(14).text(`Negocio: `, { continued: true }).font('Helvetica-Bold').text(clientName);
    doc.font('Helvetica').text(`Periodo: `, { continued: true }).font('Helvetica-Bold').text(`${monthName} ${yearStr}`);
    doc.font('Helvetica').text(`Fecha de Emisión: `, { continued: true }).font('Helvetica-Bold').text(new Date().toLocaleDateString('es-ES'));
    doc.moveDown(2);

    // Título de Sección
    doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(16).text('Resumen de KPIs Clave', { underline: true });
    doc.moveDown(1);

    // Listado de KPIs
    doc.fillColor('#333333').fontSize(12).font('Helvetica');
    
    // Función helper para dibujar filas
    const drawKpiRow = (label: string, value: string, desc: string) => {
      doc.font('Helvetica-Bold').fillColor('#1E3A8A').text(label, { continued: true })
         .font('Helvetica-Bold').fillColor('#333333').text(`: ${value}`, { continued: true })
         .font('Helvetica-Oblique').fillColor('#666666').text(`   (${desc})`);
      doc.moveDown(0.8);
    };

    drawKpiRow('Clics en Anuncios (Ads)', `${metrics.clics}`, 'Visitas estimadas a tu canal de ventas por publicidad local');
    drawKpiRow('Leads Únicos Capturados', `${metrics.leads}`, 'Clientes potenciales que iniciaron chat en WhatsApp');
    drawKpiRow('Mensajes Totales del Bot', `${metrics.messages}`, 'Interacciones y dudas resueltas de forma automática');
    drawKpiRow('Ventas Cerradas por Tarjeta', `${metrics.sales}`, 'Transacciones completadas con éxito en Mercado Pago');
    
    doc.moveDown(1);
    doc.strokeColor('#E5E7EB').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1.5);

    // Título de Retorno de Inversión (ROI)
    doc.fillColor('#10B981').font('Helvetica-Bold').fontSize(16).text('Retorno Financiero y Ahorros del Mes');
    doc.moveDown(1);

    doc.fillColor('#333333').font('Helvetica').fontSize(12);
    
    // Ingresos
    doc.font('Helvetica-Bold').text('Ingresos Generados Directos: ', { continued: true })
       .fillColor('#10B981').text(`$${metrics.revenue.toLocaleString('es-ES')} ARS`);
    doc.moveDown(0.5);

    // Tiempo Ahorrado
    doc.fillColor('#333333').font('Helvetica').text('Tiempo Operativo Ahorrado: ', { continued: true })
       .font('Helvetica-Bold').text(`${metrics.hoursSaved} Horas`);
    doc.moveDown(0.5);

    // Ahorro Estimado
    doc.font('Helvetica').text('Ahorro de Costo de Soporte Humano: ', { continued: true })
       .font('Helvetica-Bold').fillColor('#10B981').text(`+$${metrics.savings.toLocaleString('es-ES')} USD`);
    doc.moveDown(2);

    // Nota de Cierre
    doc.fillColor('#666666').font('Helvetica-Oblique').fontSize(10)
       .text('Este informe mensual ha sido compilado por Mark de manera autónoma, consolidando las estadísticas de tus webhooks de WhatsApp y Mercado Pago. El reporte histórico total está sincronizado en tu Google Sheet de Leads.', { align: 'justify' });

    doc.end();
  });
}

/**
 * Escribe los datos consolidados en la hoja "Reporte Histórico" del Google Sheet.
 */
async function writeReportToGoogleSheet(
  spreadsheetUrl: string,
  data: {
    monthLabel: string;
    clics: number;
    leads: number;
    messages: number;
    sales: number;
    revenue: number;
    savings: number;
  }
): Promise<void> {
  const auth = getGoogleAuthClient();
  if (!auth) return;

  const match = spreadsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return;
  const spreadsheetId = match[1];

  const sheets = google.sheets({ version: 'v4', auth });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Reporte Histórico!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            data.monthLabel,
            data.clics,
            data.leads,
            data.messages,
            data.sales,
            data.revenue,
            `$${data.savings} USD`
          ]
        ]
      }
    });
    console.log(`Consolidado mensual registrado en Google Sheets para el periodo: ${data.monthLabel}`);
  } catch (error) {
    console.error('Error registrando consolidado en Sheets:', error);
  }
}

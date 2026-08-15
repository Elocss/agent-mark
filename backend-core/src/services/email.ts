import { Resend } from 'resend';

let resendInstance: Resend | null = null;

function getResendClient(): Resend | null {
  if (resendInstance) {
    return resendInstance;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes('tu_resend_api_key')) {
    console.warn('ADVERTENCIA: RESEND_API_KEY no configurado. Las alertas por correo electrónico estarán desactivadas.');
    return null;
  }

  resendInstance = new Resend(apiKey);
  return resendInstance;
}

/**
 * Envía una alerta de venta por correo electrónico al comercio.
 */
export async function sendSaleNotificationEmail(
  toEmail: string,
  clientName: string,
  saleDetails: {
    buyerName: string;
    buyerPhone: string;
    productName: string;
    price: number;
    paymentMethod: string;
    transactionId: string;
  }
): Promise<void> {
  const resend = getResendClient();
  if (!resend) {
    console.log('Envío de correo omitido (Resend no configurado). Detalle de venta:', saleDetails);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'Mark Agent <onboarding@resend.dev>', // En producción se usa dominio verificado (ej. alertas@tuagencia.com)
      to: toEmail,
      subject: `🎉 Nueva Venta Registrada - ${clientName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4CAF50; text-align: center;">¡Nueva venta cerrada por Mark!</h2>
          <p>Hola, te informamos que tu agente inteligente de crecimiento ha concretado una nueva transacción comercial. Aquí tienes los detalles:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="background-color: #f2f2f2;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Concepto / Producto:</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${saleDetails.productName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Monto Cobrado:</td>
              <td style="padding: 10px; color: #4CAF50; font-weight: bold; border: 1px solid #ddd;">$${saleDetails.price} ARS</td>
            </tr>
            <tr style="background-color: #f2f2f2;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Comprador:</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${saleDetails.buyerName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Teléfono de WhatsApp:</td>
              <td style="padding: 10px; border: 1px solid #ddd;">
                <a href="https://wa.me/${saleDetails.buyerPhone}" target="_blank">${saleDetails.buyerPhone}</a>
              </td>
            </tr>
            <tr style="background-color: #f2f2f2;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Medio de Pago:</td>
              <td style="padding: 10px; border: 1px solid #ddd; text-transform: capitalize;">${saleDetails.paymentMethod}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">ID Transacción:</td>
              <td style="padding: 10px; font-size: 0.9em; color: #666; border: 1px solid #ddd;">${saleDetails.transactionId}</td>
            </tr>
          </table>
          
          <p style="text-align: center; color: #777; font-size: 0.85em; margin-top: 30px;">
            Este correo fue enviado automáticamente por el sistema Mark Growth Agent de tu agencia de marketing.
          </p>
        </div>
      `
    });

    if (error) {
      console.error('Error al enviar correo vía Resend API:', error);
    } else {
      console.log(`Correo de notificación de venta enviado a ${toEmail}. ID: ${data?.id}`);
    }
  } catch (err) {
    console.error('Excepción al enviar correo:', err);
  }
}

/**
 * Envía el reporte estadístico mensual con el PDF adjunto.
 */
export async function sendMonthlyReportEmail(
  toEmail: string,
  clientName: string,
  monthName: string,
  pdfBuffer: Buffer
): Promise<void> {
  const resend = getResendClient();
  if (!resend) {
    console.log(`Envío de reporte mensual omitido (Resend no configurado) para ${clientName}.`);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'Mark Growth <onboarding@resend.dev>',
      to: toEmail,
      subject: `📊 Informe Mensual de Crecimiento - ${clientName} (${monthName})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #1E3A8A; text-align: center;">Tu Informe Mensual de Crecimiento</h2>
          <p>Hola, te adjuntamos el reporte de rendimiento e impacto del agente inteligente **Mark** correspondiente al mes de **${monthName}**.</p>
          <p>En el PDF adjunto podrás revisar los principales KPIs:</p>
          <ul>
            <li>Clics e interés generado en redes sociales.</li>
            <li>Leads únicos capturados y conversiones en WhatsApp.</li>
            <li>Volumen total de ventas y citas concretadas de manera autónoma.</li>
            <li>Cálculo estimado del ahorro publicitario y de tiempo operativo de tu negocio.</li>
          </ul>
          <p>El histórico completo sigue estando disponible en tu hoja de Google Sheets.</p>
          <p style="margin-top: 30px; font-weight: bold;">¡Sigamos creciendo!</p>
        </div>
      `,
      attachments: [
        {
          filename: `Reporte-Mensual-${clientName.replace(/\s+/g, '-')}-${monthName}.pdf`,
          content: pdfBuffer
        }
      ]
    });

    if (error) {
      console.error('Error enviando reporte mensual vía Resend:', error);
    } else {
      console.log(`Reporte mensual enviado a ${toEmail}. ID: ${data?.id}`);
    }
  } catch (err) {
    console.error('Error enviando reporte mensual con adjunto:', err);
  }
}

import axios from 'axios';

/**
 * Servicio para interactuar con la API oficial de WhatsApp Cloud.
 */
export async function sendWhatsAppMessage(
  phoneId: string,
  accessToken: string,
  toPhone: string,
  text: string
): Promise<void> {
  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: {
          body: text
        }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`Mensaje de WhatsApp enviado con éxito a ${toPhone}. Message ID: ${response.data.messages[0].id}`);
  } catch (error: any) {
    console.error(`Error al enviar mensaje de WhatsApp a ${toPhone}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un link de pago con un formato atractivo para el cliente.
 */
export async function sendWhatsAppPaymentLink(
  phoneId: string,
  accessToken: string,
  toPhone: string,
  productName: string,
  paymentUrl: string
): Promise<void> {
  const messageText = `¡Perfecto! Aquí tienes el link de pago seguro para adquirir *${productName}*:\n\n🔗 ${paymentUrl}\n\nUna vez que realices el pago con tu tarjeta, el sistema me avisará inmediatamente para confirmar tu pedido. ¡Muchas gracias!`;
  await sendWhatsAppMessage(phoneId, accessToken, toPhone, messageText);
}

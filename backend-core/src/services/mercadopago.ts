import axios from 'axios';

/**
 * Crea una preferencia de pago dinámica en Mercado Pago.
 */
export async function createPaymentPreference(
  accessToken: string,
  clientId: string,
  leadPhone: string,
  productTitle: string,
  price: number
): Promise<string> {
  const url = 'https://api.mercadopago.com/checkout/preferences';

  // URL pública del webhook para recibir la confirmación de pago
  const backendUrl = process.env.PUBLIC_URL || 'https://tu-dominio-temporal.com';
  
  // Agregamos client_id como query parameter para saber qué token usar al recibir el webhook
  const notificationUrl = `${backendUrl}/webhooks/mercadopago?client_id=${clientId}`;

  try {
    const response = await axios.post(
      url,
      {
        items: [
          {
            title: productTitle,
            quantity: 1,
            unit_price: price,
            currency_id: 'ARS'
          }
        ],
        // Guardamos metadatos adicionales para conciliar
        external_reference: JSON.stringify({
          client_id: clientId,
          lead_phone: leadPhone,
          product_name: productTitle
        }),
        notification_url: notificationUrl,
        back_urls: {
          success: 'https://www.mercadopago.com.ar',
          pending: 'https://www.mercadopago.com.ar',
          failure: 'https://www.mercadopago.com.ar'
        },
        auto_return: 'approved'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const initPoint = response.data.init_point;
    if (!initPoint) {
      throw new Error('No se recibió la URL de checkout (init_point) de Mercado Pago.');
    }

    return initPoint;
  } catch (error: any) {
    console.error('Error creando preferencia en Mercado Pago:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Obtiene los detalles de un pago específico a partir de su ID.
 */
export async function getPaymentDetails(
  accessToken: string,
  paymentId: string
): Promise<any> {
  const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error: any) {
    console.error(`Error obteniendo detalles del pago ${paymentId} en Mercado Pago:`, error.response?.data || error.message);
    throw error;
  }
}

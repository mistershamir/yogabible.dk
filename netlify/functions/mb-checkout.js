/**
 * Netlify Function: POST /.netlify/functions/mb-checkout
 * Processes a purchase through Mindbody's checkout.
 *
 * Body:
 *   clientId (string) - Mindbody client ID
 *   items (array) - cart items, each with { type, id, quantity }
 *     type: 'Service' | 'Product'
 *     id: number (service or product ID)
 *     quantity: number
 *   payment (object):
 *     cardNumber, expMonth, expYear, cvv, cardHolder
 *     billingAddress, billingCity, billingPostalCode
 *   test (boolean) - if true, validates without charging
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    var body = JSON.parse(event.body || '{}');

    if (!body.clientId) {
      return jsonResponse(400, { error: 'clientId is required' });
    }
    if (!body.items || !body.items.length) {
      return jsonResponse(400, { error: 'At least one item is required' });
    }
    if (!body.payment || !body.payment.cardNumber) {
      return jsonResponse(400, { error: 'Payment card details are required' });
    }

    // Build cart items for Mindbody API
    var cartItems = body.items.map(function(item) {
      var cartItem = { Quantity: item.quantity || 1 };

      if (item.type === 'Service') {
        cartItem.Item = {
          Type: 'Service',
          Metadata: { Id: item.id }
        };
      } else if (item.type === 'Product') {
        cartItem.Item = {
          Type: 'Product',
          Metadata: { Id: item.id }
        };
      }

      return cartItem;
    });

    // Build payment info
    var paymentInfo = {
      Type: 'CreditCard',
      Metadata: {
        Amount: body.amount || 0,
        CardNumber: body.payment.cardNumber,
        ExpMonth: body.payment.expMonth,
        ExpYear: body.payment.expYear,
        CVV: body.payment.cvv,
        CardHolder: body.payment.cardHolder || '',
        BillingAddress: body.payment.billingAddress || '',
        BillingCity: body.payment.billingCity || '',
        BillingPostalCode: body.payment.billingPostalCode || '',
        SaveInfo: body.payment.saveCard || false
      }
    };

    var checkoutData = {
      ClientId: body.clientId,
      CartItems: cartItems,
      Payments: [paymentInfo],
      Test: body.test || false,
      SendEmail: true,
      InStore: false
    };

    // NOTE: Card data is passed through to Mindbody and never stored.
    var data = await mbFetch('/sale/checkoutshoppingcart', {
      method: 'POST',
      body: JSON.stringify(checkoutData)
    });

    // Handle SCA (Strong Customer Authentication) if required
    if (data.AuthenticationUrls && data.AuthenticationUrls.length > 0) {
      return jsonResponse(202, {
        requiresSCA: true,
        authenticationUrl: data.AuthenticationUrls[0],
        transactionIds: data.TransactionIds || [],
        message: 'Card requires additional authentication'
      });
    }

    return jsonResponse(200, {
      success: true,
      transactionId: (data.TransactionIds && data.TransactionIds[0]) || null,
      message: 'Purchase completed successfully'
    });
  } catch (err) {
    console.error('mb-checkout error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

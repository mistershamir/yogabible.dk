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
const { createMilestonePost } = require('./shared/social-sync');

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
    if (!body.payment) {
      return jsonResponse(400, { error: 'Payment details are required' });
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

    // Build payment info — StoredCard (last four only) or new CreditCard
    var paymentInfo;
    if (body.payment.useStoredCard && body.payment.lastFour) {
      paymentInfo = {
        Type: 'StoredCard',
        Metadata: {
          LastFour: String(body.payment.lastFour),
          Amount: String(body.amount || 0)
        }
      };
    } else {
      if (!body.payment.cardNumber) {
        return jsonResponse(400, { error: 'Card number is required' });
      }
      // Mindbody v6 Metadata is Dictionary<string, string>
      // ALL values MUST be strings, not numbers or booleans
      paymentInfo = {
        Type: 'CreditCard',
        Metadata: {
          amount: String(body.amount || 0),
          creditCardNumber: String(body.payment.cardNumber),
          expMonth: String(body.payment.expMonth),
          expYear: String(body.payment.expYear),
          cvv: String(body.payment.cvv),
          billingName: String(body.payment.cardHolder || ''),
          billingAddress: String(body.payment.billingAddress || ''),
          billingCity: String(body.payment.billingCity || ''),
          billingPostalCode: String(body.payment.billingPostalCode || ''),
          saveInfo: String(body.payment.saveCard || false)
        }
      };
    }

    var checkoutData = {
      ClientId: body.clientId,
      Items: cartItems,
      Payments: [paymentInfo],
      Test: body.test || false,
      SendEmail: true,
      InStore: false
    };

    // NOTE: Card data is passed through to Mindbody and never stored.
    // Log request shape for debugging (no card details)
    console.log('mb-checkout request:', JSON.stringify({
      ClientId: checkoutData.ClientId,
      CartItems: checkoutData.CartItems,
      PaymentType: paymentInfo.Type,
      MetadataKeys: Object.keys(paymentInfo.Metadata),
      Amount: paymentInfo.Metadata.amount,
      Test: checkoutData.Test,
      InStore: checkoutData.InStore
    }));

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

    // Social proof: milestone post for Prep Phase purchases (non-blocking)
    var PREP_PHASE_IDS = [100078, 100121, 100211, 100209, 100210, 100212];
    var purchasedItem = body.items && body.items[0];
    if (purchasedItem && PREP_PHASE_IDS.indexOf(purchasedItem.id) >= 0) {
      createMilestonePost('prep_phase_purchased', {
        productId: purchasedItem.id
      }).catch(function (err) {
        console.warn('[mb-checkout] Social milestone error (non-blocking):', err.message);
      });
    }

    return jsonResponse(200, {
      success: true,
      transactionId: (data.TransactionIds && data.TransactionIds[0]) || null,
      message: 'Purchase completed successfully'
    });
  } catch (err) {
    console.error('mb-checkout error:', err.message, err.data ? JSON.stringify(err.data) : '');
    var errorMsg = err.message || 'Checkout failed';
    // Include Mindbody error details if available
    if (err.data && err.data.Error && err.data.Error.Message) {
      errorMsg = err.data.Error.Message;
    }
    return jsonResponse(err.status || 500, { error: errorMsg, details: err.data || null, _v: 7 });
  }
};

/**
 * mb-giftcards — Gift card endpoints
 * GET: Fetch available gift cards for purchase
 * POST: Purchase a gift card (sends to recipient via email)
 */
const { mbFetch, corsHeaders, jsonResponse } = require('./shared/mb-api');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  try {
    // GET — list available gift cards
    if (event.httpMethod === 'GET') {
      const locationId = event.queryStringParameters?.locationId || '1';
      const data = await mbFetch(`/sale/giftcards?LocationId=${locationId}&SoldOnline=true`);
      const cards = (data.GiftCards || []).map(gc => ({
        id: gc.Id,
        description: gc.Description || '',
        value: gc.CardValue || 0,
        salePrice: gc.SalePrice || gc.CardValue || 0,
        soldOnline: gc.SoldOnline,
        editableByConsumer: gc.EditableByConsumer || false,
        terms: gc.GiftCardTerms || '',
        contactInfo: gc.ContactInfo || '',
        displayLogo: gc.DisplayLogo || false,
        layouts: (gc.Layouts || []).map(l => ({
          id: l.LayoutId,
          name: l.LayoutName || ''
        }))
      }));
      return jsonResponse(200, { giftCards: cards });
    }

    // POST — purchase a gift card
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { giftCardId, clientId, recipientEmail, recipientName, title, message, deliveryDate, layoutId, locationId, payment, customAmount, salePrice } = body;

      if (!giftCardId || !clientId || !recipientEmail || !recipientName) {
        return jsonResponse(400, { error: 'Missing required fields: giftCardId, clientId, recipientEmail, recipientName' });
      }

      if (!payment) {
        return jsonResponse(400, { error: 'Payment information is required' });
      }

      // Determine the payment amount (custom amount or default card value)
      const paymentAmount = customAmount ? parseFloat(customAmount) : (salePrice ? parseFloat(salePrice) : 0);

      // Validate: custom amount gift cards must have a positive amount
      if (customAmount !== undefined && paymentAmount <= 0) {
        return jsonResponse(400, { error: 'Custom amount must be greater than 0' });
      }

      // Build PaymentInfo — StoredCard (last four only) or new CreditCard
      let paymentInfo;
      if (payment.useStoredCard && payment.lastFour) {
        paymentInfo = {
          Type: 'StoredCard',
          Metadata: {
            LastFour: String(payment.lastFour),
            Amount: String(paymentAmount)
          }
        };
      } else {
        if (!payment.cardNumber) {
          return jsonResponse(400, { error: 'Card number is required' });
        }
        paymentInfo = {
          Type: 'CreditCard',
          Metadata: {
            amount: String(paymentAmount),
            creditCardNumber: String(payment.cardNumber),
            expMonth: String(payment.expMonth),
            expYear: String(payment.expYear),
            cvv: String(payment.cvv),
            billingName: String(payment.cardHolder || recipientName),
            billingAddress: String(payment.billingAddress || ''),
            billingCity: String(payment.billingCity || ''),
            billingPostalCode: String(payment.billingPostalCode || ''),
            saveInfo: String(payment.saveCard || false)
          }
        };
      }

      const purchaseData = {
        LocationId: parseInt(locationId || '1', 10),
        GiftCardId: parseInt(giftCardId, 10),
        PurchaserClientId: String(clientId),
        RecipientEmail: recipientEmail,
        RecipientName: recipientName,
        Title: title || 'Gift Card',
        SendEmailReceipt: true,
        Test: false,
        PaymentInfo: paymentInfo
      };

      // For custom-amount gift cards, set the card value
      if (customAmount && paymentAmount > 0) {
        purchaseData.CardValue = paymentAmount;
      }

      if (message) purchaseData.GiftMessage = message;
      if (deliveryDate) purchaseData.DeliveryDate = deliveryDate;
      if (layoutId) purchaseData.LayoutId = parseInt(layoutId, 10);

      console.log('[mb-giftcards] Purchasing gift card:', JSON.stringify(purchaseData));

      const result = await mbFetch('/sale/purchasegiftcard', {
        method: 'POST',
        body: JSON.stringify(purchaseData)
      });

      return jsonResponse(200, {
        success: true,
        barcodeId: result.BarcodeId,
        value: result.Value,
        amountPaid: result.AmountPaid,
        saleId: result.SaleId,
        recipientEmail: result.RecipientEmail
      });
    }

    return jsonResponse(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[mb-giftcards] Error:', err.message, err.data ? JSON.stringify(err.data) : '');
    // Extract detailed error message from Mindbody response
    let errorMsg = err.message || 'Gift card operation failed';
    if (err.data) {
      if (err.data.Error && err.data.Error.Message) errorMsg = err.data.Error.Message;
      else if (err.data.Message) errorMsg = err.data.Message;
    }
    return jsonResponse(err.status || 500, {
      error: errorMsg,
      _debug: err.data || null
    });
  }
};

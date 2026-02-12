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
      // Log layouts for debugging email delivery issues
      (data.GiftCards || []).forEach(gc => {
        console.log(`[mb-giftcards] Card "${gc.Description}" (ID:${gc.Id}): Layouts=${JSON.stringify(gc.Layouts || [])}, EditableByConsumer=${gc.EditableByConsumer}`);
      });
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

      // Determine the payment amount and card value
      const cardValue = customAmount ? parseFloat(customAmount) : (salePrice ? parseFloat(salePrice) : 0);
      const isCustomAmount = !!customAmount;

      // Validate: custom amount gift cards must have a positive amount
      if (isCustomAmount && cardValue <= 0) {
        return jsonResponse(400, { error: 'Custom amount must be greater than 0' });
      }

      // Payment amount = the custom amount or the card's sale price
      const paymentAmount = cardValue;

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
        PaymentInfo: paymentInfo,
        // ConsumerPresent=true tells Mindbody this is a consumer-driven purchase.
        // For EditableByConsumer gift cards, this should allow the consumer to set
        // the price/value without needing staff "edit price" permission.
        ConsumerPresent: true
      };

      // For custom-amount gift cards, include CardValue in case Mindbody uses it
      if (isCustomAmount && cardValue > 0) {
        purchaseData.CardValue = cardValue;
      }

      if (message) purchaseData.GiftMessage = message;
      if (deliveryDate) purchaseData.DeliveryDate = deliveryDate;

      // LayoutId is REQUIRED for Mindbody to send the gift card email to the recipient.
      // Use provided layoutId if it's a positive number, otherwise auto-resolve from API.
      if (layoutId && parseInt(layoutId, 10) > 0) {
        purchaseData.LayoutId = parseInt(layoutId, 10);
      }

      // If no valid LayoutId yet (frontend sent 0 or none), fetch layouts from the API
      if (!purchaseData.LayoutId) {
        try {
          const gcData = await mbFetch(`/sale/giftcards?LocationId=${purchaseData.LocationId}&SoldOnline=true`);
          const matchingCard = (gcData.GiftCards || []).find(gc => gc.Id === parseInt(giftCardId, 10));
          if (matchingCard && matchingCard.Layouts && matchingCard.Layouts.length > 0) {
            purchaseData.LayoutId = matchingCard.Layouts[0].LayoutId;
            console.log('[mb-giftcards] Auto-resolved LayoutId:', purchaseData.LayoutId);
          } else {
            console.warn('[mb-giftcards] WARNING: No layouts found for gift card', giftCardId, '— recipient email will NOT be sent by Mindbody');
          }
        } catch (layoutErr) {
          console.warn('[mb-giftcards] Could not fetch layouts:', layoutErr.message);
        }
      }

      console.log('[mb-giftcards] Purchasing gift card:', JSON.stringify(purchaseData));

      const result = await mbFetch('/sale/purchasegiftcard', {
        method: 'POST',
        body: JSON.stringify(purchaseData)
      });

      console.log('[mb-giftcards] Purchase response:', JSON.stringify(result));

      return jsonResponse(200, {
        success: true,
        barcodeId: result.BarcodeId,
        value: result.Value,
        amountPaid: result.AmountPaid,
        saleId: result.SaleId,
        recipientEmail: result.RecipientEmail,
        emailSent: !!purchaseData.LayoutId
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

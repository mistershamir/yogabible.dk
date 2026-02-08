/**
 * Netlify Function: GET /.netlify/functions/mb-contracts
 * Fetches available contracts/memberships for purchase from Mindbody.
 *
 * Query params:
 *   contractId (optional) - specific contract ID
 *   locationId (optional) - filter by location
 *   sellOnline (optional) - 'true' for online-purchasable only
 *
 * POST: Purchase a contract for a client.
 *   clientId (string) - Mindbody client ID
 *   contractId (number) - contract to purchase
 *   startDate (string) - YYYY-MM-DD when contract starts
 *   payment (object) - card details (same shape as mb-checkout)
 *   promoCode (string, optional) - promotional code
 *   test (boolean, optional)
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // GET: Fetch available contracts
  if (event.httpMethod === 'GET') {
    try {
      var params = event.queryStringParameters || {};
      var qsParams = {};

      if (params.contractId) qsParams.ContractIds = params.contractId;
      if (params.locationId) qsParams.LocationId = params.locationId;
      if (params.sellOnline === 'true') qsParams.SellOnline = 'true';
      if (params.limit) qsParams.Limit = params.limit;

      var queryString = Object.keys(qsParams).length ? '?' + new URLSearchParams(qsParams).toString() : '';
      console.log('[mb-contracts] GET path: /sale/contracts' + queryString);

      var data;
      try {
        data = await mbFetch('/sale/contracts' + queryString);
      } catch (firstErr) {
        // Log the full error details from Mindbody
        console.error('[mb-contracts] First attempt failed:', firstErr.message);
        console.error('[mb-contracts] Error data:', JSON.stringify(firstErr.data || {}));

        // Retry with LocationId=1 (common default for single-location sites)
        console.log('[mb-contracts] Retrying with LocationId=1...');
        var retryQs = queryString ? queryString + '&LocationId=1' : '?LocationId=1';
        try {
          data = await mbFetch('/sale/contracts' + retryQs);
        } catch (secondErr) {
          console.error('[mb-contracts] Retry with LocationId also failed:', secondErr.message);
          console.error('[mb-contracts] Retry error data:', JSON.stringify(secondErr.data || {}));
          throw secondErr;
        }
      }

      console.log('[mb-contracts] Raw response keys:', Object.keys(data));
      console.log('[mb-contracts] Contracts count:', (data.Contracts || []).length);
      if ((data.Contracts || []).length > 0) {
        console.log('[mb-contracts] First contract sample:', JSON.stringify(data.Contracts[0]).substring(0, 300));
      } else {
        console.log('[mb-contracts] No contracts returned. Full response:', JSON.stringify(data).substring(0, 500));
      }

      var contracts = (data.Contracts || []).map(function(c) {
        return {
          id: c.Id,
          name: c.Name || '',
          description: c.Description || '',
          assignsMembershipId: c.AssignsMembershipId || null,
          assignsMembershipName: c.AssignsMembershipName || '',
          contractItems: (c.ContractItems || []).map(function(ci) {
            return {
              id: ci.Id,
              name: ci.Name || '',
              price: ci.TotalPrice || ci.Price || 0,
              taxAmount: ci.TaxAmount || 0,
              recurringPaymentAmount: ci.RecurringPaymentAmount || 0,
              frequency: ci.AutopayFrequency || '',
              numberOfPayments: ci.NumberOfPayments || 0
            };
          }),
          soldOnline: c.SoldOnline || false,
          firstPaymentAmount: c.FirstPaymentAmountSubtotal || null,
          firstPaymentTax: c.FirstPaymentTaxAmount || null,
          recurringPaymentAmount: c.RecurringPaymentAmountSubtotal || null,
          totalContractAmount: c.TotalContractAmountSubtotal || null,
          duration: c.Duration || null,
          durationUnit: c.DurationUnit || '',
          autopaySchedule: c.AutopaySchedule || '',
          numberOfAutopays: c.NumberOfAutopays || null,
          locationId: c.LocationId || null,
          programIds: c.ProgramIds || [],
          membershipTypeRestrictions: c.MembershipTypeRestrictions || []
        };
      });

      return jsonResponse(200, { contracts: contracts, total: contracts.length });
    } catch (err) {
      console.error('[mb-contracts] GET error:', err.message);
      console.error('[mb-contracts] GET error data:', JSON.stringify(err.data || {}));
      var errorDetail = err.message || 'Unknown error';
      if (err.data) {
        if (err.data.Error && err.data.Error.Message) errorDetail = err.data.Error.Message;
        else if (err.data.Message) errorDetail = err.data.Message;
      }
      return jsonResponse(err.status || 500, {
        error: errorDetail,
        _debug: {
          status: err.status,
          rawError: err.data || null
        }
      });
    }
  }

  // POST: Purchase a contract
  if (event.httpMethod === 'POST') {
    try {
      var body = JSON.parse(event.body || '{}');

      if (!body.clientId || !body.contractId) {
        return jsonResponse(400, { error: 'clientId and contractId are required' });
      }

      var purchaseBody = {
        ClientId: body.clientId,
        ContractId: body.contractId,
        StartDate: body.startDate || new Date().toISOString().split('T')[0],
        Test: body.test || false,
        SendNotifications: true
      };

      if (body.promoCode) {
        purchaseBody.PromotionCode = body.promoCode;
      }

      // Add payment if provided
      if (body.payment && body.payment.cardNumber) {
        purchaseBody.CreditCardInfo = {
          CreditCardNumber: String(body.payment.cardNumber),
          ExpMonth: String(body.payment.expMonth),
          ExpYear: String(body.payment.expYear),
          CVV: String(body.payment.cvv),
          BillingName: String(body.payment.cardHolder || ''),
          BillingAddress: String(body.payment.billingAddress || ''),
          BillingCity: String(body.payment.billingCity || ''),
          BillingPostalCode: String(body.payment.billingPostalCode || ''),
          SaveInfo: body.payment.saveCard ? true : false
        };
      }

      console.log('mb-contracts POST:', JSON.stringify({
        ClientId: purchaseBody.ClientId,
        ContractId: purchaseBody.ContractId,
        StartDate: purchaseBody.StartDate,
        HasPayment: !!purchaseBody.CreditCardInfo,
        PromoCode: purchaseBody.PromotionCode || null
      }));

      var data = await mbFetch('/sale/purchasecontract', {
        method: 'POST',
        body: JSON.stringify(purchaseBody)
      });

      return jsonResponse(200, {
        success: true,
        contractId: data.ContractId || body.contractId,
        clientContractId: data.ClientContractId || null,
        message: 'Contract purchased successfully'
      });
    } catch (err) {
      console.error('mb-contracts POST error:', err.message, err.data ? JSON.stringify(err.data) : '');
      var errorMsg = err.message || 'Contract purchase failed';
      if (err.data && err.data.Error && err.data.Error.Message) {
        errorMsg = err.data.Error.Message;
      }
      return jsonResponse(err.status || 500, { error: errorMsg });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};

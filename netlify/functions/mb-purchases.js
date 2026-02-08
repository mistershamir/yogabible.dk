/**
 * Netlify Function: GET /.netlify/functions/mb-purchases
 * Fetches client purchase history / receipts from Mindbody.
 *
 * Query params:
 *   clientId (required) - Mindbody client ID
 *   startDate (YYYY-MM-DD) - defaults to 365 days ago
 *   endDate (YYYY-MM-DD) - defaults to today
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    var params = event.queryStringParameters || {};

    if (!params.clientId) {
      return jsonResponse(400, { error: 'clientId is required' });
    }

    var now = new Date();
    var startDate = params.startDate || new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0];
    var endDate = params.endDate || now.toISOString().split('T')[0];

    var queryString = new URLSearchParams({
      ClientId: params.clientId,
      StartDate: startDate,
      EndDate: endDate,
      Limit: '200'
    }).toString();

    console.log('mb-purchases query:', queryString);
    var data = await mbFetch('/sale/clientpurchases?' + queryString);

    var purchases = (data.Purchases || []).map(function(p) {
      // Build payment details string
      var paymentMethod = '';
      var paymentLast4 = '';
      if (p.Payments && p.Payments.length) {
        paymentMethod = p.Payments[0].Method || '';
        if (p.Payments[0].Last4Digits) paymentLast4 = p.Payments[0].Last4Digits;
        else if (p.Payments[0].Notes) paymentLast4 = p.Payments[0].Notes;
      }

      return {
        id: p.Id,
        saleDate: p.SaleDate,
        saleTime: p.SaleTime,
        description: p.Description || '',
        accountPayment: p.AccountPayment || false,
        price: p.Price || 0,
        amountPaid: p.AmountPaid || 0,
        discount: p.Discount || 0,
        tax: p.Tax || 0,
        returned: p.Returned || false,
        quantity: p.Quantity || 1,
        serviceName: p.Service ? p.Service.Name : (p.Product ? p.Product.Name : p.Description || ''),
        serviceId: p.Service ? p.Service.Id : null,
        productId: p.Product ? p.Product.Id : null,
        paymentMethod: paymentMethod,
        paymentLast4: paymentLast4,
        locationName: p.Location ? p.Location.Name : '',
        saleId: p.SaleId || null
      };
    });

    return jsonResponse(200, { purchases: purchases, total: purchases.length });
  } catch (err) {
    console.error('mb-purchases error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

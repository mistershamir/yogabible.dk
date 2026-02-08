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

    // Try /sale/sales (more reliable) with ClientId filter
    // Params: StartSaleDateTime, EndSaleDateTime, ClientId, Limit
    var queryString = new URLSearchParams({
      ClientId: params.clientId,
      StartSaleDateTime: startDate + 'T00:00:00',
      EndSaleDateTime: endDate + 'T23:59:59',
      Limit: '200'
    }).toString();

    console.log('mb-purchases query (sale/sales):', queryString);

    var data;
    var purchases = [];

    try {
      data = await mbFetch('/sale/sales?' + queryString);
      var sales = data.Sales || [];
      console.log('mb-purchases: /sale/sales returned', sales.length, 'sales');

      // Each Sale has Items array with the purchased line items
      sales.forEach(function(sale) {
        var items = sale.Items || [];
        items.forEach(function(item) {
          purchases.push({
            id: item.Id || sale.Id,
            saleId: sale.Id,
            saleDate: sale.SaleDateTime || sale.SaleDate,
            description: item.Description || '',
            price: item.Price || 0,
            amountPaid: item.AmountPaid || item.Price || 0,
            discount: item.Discount || 0,
            tax: item.Tax || 0,
            returned: item.Returned || false,
            quantity: item.Quantity || 1,
            serviceName: item.Description || '',
            paymentMethod: (sale.Payments && sale.Payments.length) ? sale.Payments[0].Method || '' : '',
            paymentLast4: (sale.Payments && sale.Payments.length && sale.Payments[0].Last4) ? sale.Payments[0].Last4 : '',
            locationName: sale.LocationId ? ('Location ' + sale.LocationId) : ''
          });
        });
      });
    } catch (salesErr) {
      console.warn('mb-purchases: /sale/sales failed:', salesErr.message, '— trying /sale/clientpurchases');

      // Fallback to /sale/clientpurchases
      var fallbackQs = new URLSearchParams({
        ClientId: params.clientId,
        StartDate: startDate,
        EndDate: endDate,
        Limit: '200'
      }).toString();

      data = await mbFetch('/sale/clientpurchases?' + fallbackQs);

      purchases = (data.Purchases || []).map(function(p) {
        var paymentMethod = '';
        var paymentLast4 = '';
        if (p.Payments && p.Payments.length) {
          paymentMethod = p.Payments[0].Method || '';
          if (p.Payments[0].Last4Digits) paymentLast4 = p.Payments[0].Last4Digits;
          else if (p.Payments[0].Notes) paymentLast4 = p.Payments[0].Notes;
        }

        return {
          id: p.Id,
          saleId: p.SaleId || null,
          saleDate: p.SaleDate,
          description: p.Description || '',
          price: p.Price || 0,
          amountPaid: p.AmountPaid || 0,
          discount: p.Discount || 0,
          tax: p.Tax || 0,
          returned: p.Returned || false,
          quantity: p.Quantity || 1,
          serviceName: p.Service ? p.Service.Name : (p.Product ? p.Product.Name : p.Description || ''),
          paymentMethod: paymentMethod,
          paymentLast4: paymentLast4,
          locationName: p.Location ? p.Location.Name : ''
        };
      });
    }

    console.log('mb-purchases: returning', purchases.length, 'purchases total');
    return jsonResponse(200, { purchases: purchases, total: purchases.length });
  } catch (err) {
    console.error('mb-purchases error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

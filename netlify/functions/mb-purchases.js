/**
 * Netlify Function: GET /.netlify/functions/mb-purchases
 * Fetches client purchase history / receipts from Mindbody.
 *
 * Query params:
 *   clientId (required) - Mindbody client ID
 *   startDate (YYYY-MM-DD) - defaults to 365 days ago
 *   endDate (YYYY-MM-DD) - defaults to today
 *
 * Strategy: tries 3 endpoints in sequence until data is found:
 *   1. GET /sale/sales (with ClientId param — works on most MB sites)
 *   2. GET /sale/sales (without ClientId, filter server-side — fallback if #1 returns empty)
 *   3. GET /client/clientservices + /client/clientcontracts (shows purchased services as receipts)
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
    var purchases = [];

    // ── Strategy 1: /sale/sales with ClientId ──
    try {
      var salesQs = 'ClientId=' + params.clientId +
        '&StartSaleDateTime=' + encodeURIComponent(startDate + 'T00:00:00') +
        '&EndSaleDateTime=' + encodeURIComponent(endDate + 'T23:59:59') +
        '&Limit=200';

      console.log('[mb-purchases] Strategy 1: /sale/sales with ClientId:', salesQs);
      var salesData = await mbFetch('/sale/sales?' + salesQs);
      var sales = salesData.Sales || [];
      console.log('[mb-purchases] /sale/sales returned', sales.length, 'sales. Keys:', Object.keys(salesData).join(','));

      purchases = parseSales(sales);
    } catch (err1) {
      console.warn('[mb-purchases] Strategy 1 failed:', err1.message);
    }

    // ── Strategy 2: /sale/sales WITHOUT ClientId, filter server-side ──
    if (purchases.length === 0) {
      try {
        // Narrow date range to reduce results (last 90 days max for unfiltered)
        var narrowStart = startDate;
        var daysDiff = (now.getTime() - new Date(startDate).getTime()) / 86400000;
        if (daysDiff > 90) {
          narrowStart = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];
        }

        var unfilteredQs = 'StartSaleDateTime=' + encodeURIComponent(narrowStart + 'T00:00:00') +
          '&EndSaleDateTime=' + encodeURIComponent(endDate + 'T23:59:59') +
          '&Limit=200';

        console.log('[mb-purchases] Strategy 2: /sale/sales unfiltered:', unfilteredQs);
        var unfilteredData = await mbFetch('/sale/sales?' + unfilteredQs);
        var allSales = unfilteredData.Sales || [];
        console.log('[mb-purchases] Unfiltered returned', allSales.length, 'sales total');

        // Filter by ClientId (check sale-level and item-level)
        var clientSales = allSales.filter(function(sale) {
          if (String(sale.ClientId) === String(params.clientId)) return true;
          if (String(sale.RecipientClientId) === String(params.clientId)) return true;
          // Also check Items for the client
          var items = sale.Items || [];
          for (var i = 0; i < items.length; i++) {
            if (String(items[i].ClientId) === String(params.clientId)) return true;
          }
          return false;
        });
        console.log('[mb-purchases] After client filter:', clientSales.length, 'matching sales for clientId', params.clientId);

        if (clientSales.length > 0) {
          purchases = parseSales(clientSales);
        }
      } catch (err2) {
        console.warn('[mb-purchases] Strategy 2 failed:', err2.message);
      }
    }

    // ── Strategy 3: build receipts from /client/clientservices + contracts ──
    if (purchases.length === 0) {
      try {
        console.log('[mb-purchases] Strategy 3: /client/clientservices for clientId:', params.clientId);

        // Fetch client services (passes, clip cards, etc.)
        var svcData = await mbFetch('/client/clientservices?ClientId=' + params.clientId + '&CrossRegionalLookup=false');
        var services = svcData.ClientServices || [];
        console.log('[mb-purchases] Found', services.length, 'client services');

        services.forEach(function(svc) {
          var activeDate = svc.ActiveDate || svc.SaleDate || '';
          if (!activeDate) return;

          var svcDate = activeDate.split('T')[0];
          if (svcDate < startDate || svcDate > endDate) return;

          purchases.push({
            id: svc.Id,
            saleId: svc.Id,
            saleDate: activeDate,
            description: svc.Name || '',
            serviceName: svc.Name || '',
            // Extract price from the service
            price: svc.Price || svc.OnlinePrice || 0,
            amountPaid: svc.Price || svc.OnlinePrice || 0,
            discount: 0,
            tax: 0,
            returned: false,
            quantity: 1,
            paymentMethod: '',
            paymentLast4: '',
            locationName: svc.Location ? svc.Location.Name : '',
            // Extra fields for enriched display
            type: 'service',
            remaining: typeof svc.Remaining === 'number' ? svc.Remaining : null,
            count: svc.Count || null,
            current: svc.Current || false,
            expirationDate: svc.ExpirationDate || null,
            programName: svc.Program ? svc.Program.Name : ''
          });
        });

        // Also fetch contracts (memberships)
        try {
          var contractData = await mbFetch('/client/clientcontracts?ClientId=' + params.clientId);
          var contracts = contractData.Contracts || [];
          console.log('[mb-purchases] Found', contracts.length, 'client contracts');

          contracts.forEach(function(c) {
            var cDate = c.AgreementDate || c.StartDate || '';
            if (!cDate) return;

            var contractDate = cDate.split('T')[0];
            if (contractDate < startDate || contractDate > endDate) return;

            purchases.push({
              id: c.Id,
              saleId: c.Id,
              saleDate: cDate,
              description: c.Name || c.ContractName || '',
              serviceName: (c.Name || c.ContractName || ''),
              price: c.TotalAmount || c.AutopayAmount || 0,
              amountPaid: c.TotalAmount || c.AutopayAmount || 0,
              discount: 0,
              tax: 0,
              returned: false,
              quantity: 1,
              paymentMethod: c.AutopayStatus === 'Active' ? 'Autopay' : '',
              paymentLast4: '',
              locationName: c.LocationId ? ('Location ' + c.LocationId) : '',
              // Extra fields
              type: 'contract',
              contractEndDate: c.EndDate || null,
              autopayStatus: c.AutopayStatus || null,
              autopayAmount: c.AutopayAmount || 0
            });
          });
        } catch (contractErr) {
          console.warn('[mb-purchases] /client/clientcontracts failed:', contractErr.message);
        }
      } catch (err3) {
        console.warn('[mb-purchases] Strategy 3 failed:', err3.message);
      }
    }

    console.log('[mb-purchases] Returning', purchases.length, 'purchases total');
    return jsonResponse(200, { purchases: purchases, total: purchases.length });
  } catch (err) {
    console.error('[mb-purchases] Fatal error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

/**
 * Parse Mindbody Sales array into normalized purchase objects.
 */
function parseSales(sales) {
  var purchases = [];
  sales.forEach(function(sale) {
    var items = sale.Items || [];
    if (items.length === 0) {
      // Sale with no items — add as single purchase
      purchases.push({
        id: sale.Id,
        saleId: sale.Id,
        saleDate: sale.SaleDateTime || sale.SaleDate,
        description: sale.Description || 'Sale #' + sale.Id,
        serviceName: sale.Description || 'Sale #' + sale.Id,
        price: sale.TotalAmount || 0,
        amountPaid: sale.TotalAmount || 0,
        discount: sale.DiscountAmount || 0,
        tax: sale.TaxAmount || 0,
        returned: sale.IsReturned || false,
        quantity: 1,
        paymentMethod: getPaymentMethod(sale),
        paymentLast4: getPaymentLast4(sale),
        locationName: sale.LocationId ? ('Location ' + sale.LocationId) : '',
        type: 'sale'
      });
    } else {
      items.forEach(function(item) {
        purchases.push({
          id: item.Id || sale.Id,
          saleId: sale.Id,
          saleDate: sale.SaleDateTime || sale.SaleDate,
          description: item.Description || '',
          serviceName: item.Description || '',
          price: item.Price || item.TotalAmount || 0,
          amountPaid: item.AmountPaid || item.TotalAmount || item.Price || 0,
          discount: item.DiscountAmount || item.Discount || 0,
          tax: item.TaxAmount || item.Tax || 0,
          returned: item.Returned || item.IsReturned || false,
          quantity: item.Quantity || 1,
          paymentMethod: getPaymentMethod(sale),
          paymentLast4: getPaymentLast4(sale),
          locationName: sale.LocationId ? ('Location ' + sale.LocationId) : '',
          type: 'sale'
        });
      });
    }
  });
  return purchases;
}

function getPaymentMethod(sale) {
  if (!sale.Payments || !sale.Payments.length) return '';
  var p = sale.Payments[0];
  return p.Method || p.PaymentMethod || p.Type || '';
}

function getPaymentLast4(sale) {
  if (!sale.Payments || !sale.Payments.length) return '';
  var p = sale.Payments[0];
  return p.Last4 || p.Last4Digits || '';
}

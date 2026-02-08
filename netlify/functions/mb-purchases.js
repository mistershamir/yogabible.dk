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
 *   1. GET /sale/sales (with ClientId param)
 *   2. GET /sale/clientpurchases (dedicated client purchases endpoint)
 *   3. GET /client/clientservices (fallback: shows purchased services as receipts)
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

      console.log('[mb-purchases] Trying /sale/sales with:', salesQs);
      var salesData = await mbFetch('/sale/sales?' + salesQs);
      var sales = salesData.Sales || [];
      console.log('[mb-purchases] /sale/sales returned', sales.length, 'sales. Keys:', Object.keys(salesData).join(','));

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
    } catch (err1) {
      console.warn('[mb-purchases] /sale/sales failed:', err1.message);
    }

    // ── Strategy 2: /sale/clientpurchases (if Strategy 1 returned nothing) ──
    if (purchases.length === 0) {
      try {
        var cpQs = 'ClientId=' + params.clientId +
          '&StartDate=' + startDate +
          '&EndDate=' + endDate +
          '&Limit=200';

        console.log('[mb-purchases] Trying /sale/clientpurchases with:', cpQs);
        var cpData = await mbFetch('/sale/clientpurchases?' + cpQs);
        console.log('[mb-purchases] /sale/clientpurchases returned keys:', Object.keys(cpData).join(','));

        var cpList = cpData.Purchases || [];
        console.log('[mb-purchases] /sale/clientpurchases count:', cpList.length);

        purchases = cpList.map(function(p) {
          var paymentMethod = '';
          var paymentLast4 = '';
          if (p.Payments && p.Payments.length) {
            paymentMethod = p.Payments[0].Method || '';
            if (p.Payments[0].Last4Digits) paymentLast4 = p.Payments[0].Last4Digits;
            else if (p.Payments[0].Notes) paymentLast4 = p.Payments[0].Notes;
          }

          return {
            id: p.Id,
            saleId: p.SaleId || p.Id,
            saleDate: p.SaleDate || p.SaleDateTime,
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
      } catch (err2) {
        console.warn('[mb-purchases] /sale/clientpurchases failed:', err2.message);
      }
    }

    // ── Strategy 3: build receipts from /client/clientservices (if still nothing) ──
    if (purchases.length === 0) {
      try {
        console.log('[mb-purchases] Trying /client/clientservices as fallback for clientId:', params.clientId);
        var svcData = await mbFetch('/client/clientservices?ClientId=' + params.clientId + '&CrossRegionalLookup=false');
        console.log('[mb-purchases] /client/clientservices returned keys:', Object.keys(svcData).join(','));

        var services = svcData.ClientServices || [];
        console.log('[mb-purchases] Found', services.length, 'client services');

        services.forEach(function(svc) {
          // Only include services within date range
          var activeDate = svc.ActiveDate || svc.SaleDate || '';
          if (activeDate) {
            var svcDate = activeDate.split('T')[0];
            if (svcDate >= startDate && svcDate <= endDate) {
              purchases.push({
                id: svc.Id,
                saleId: svc.Id,
                saleDate: activeDate,
                description: svc.Name || '',
                price: svc.PaymentAmount || svc.Price || 0,
                amountPaid: svc.PaymentAmount || svc.Price || 0,
                discount: 0,
                tax: 0,
                returned: false,
                quantity: 1,
                serviceName: svc.Name || '',
                paymentMethod: 'Service',
                paymentLast4: '',
                locationName: '',
                remaining: svc.Remaining || null,
                current: svc.Current || false,
                programName: svc.Program ? svc.Program.Name : ''
              });
            }
          }
        });

        // Also try /client/clientcontracts for memberships
        try {
          var contractData = await mbFetch('/client/clientcontracts?ClientId=' + params.clientId);
          var contracts = contractData.Contracts || [];
          console.log('[mb-purchases] Found', contracts.length, 'client contracts');

          contracts.forEach(function(c) {
            var cDate = c.AgreementDate || c.StartDate || '';
            if (cDate) {
              var contractDate = cDate.split('T')[0];
              if (contractDate >= startDate && contractDate <= endDate) {
                purchases.push({
                  id: c.Id,
                  saleId: c.Id,
                  saleDate: cDate,
                  description: c.Name || c.ContractName || '',
                  price: c.TotalAmount || c.AutopayAmount || 0,
                  amountPaid: c.TotalAmount || c.AutopayAmount || 0,
                  discount: 0,
                  tax: 0,
                  returned: false,
                  quantity: 1,
                  serviceName: (c.Name || c.ContractName || '') + ' (Membership)',
                  paymentMethod: 'Contract',
                  paymentLast4: '',
                  locationName: c.LocationId ? ('Location ' + c.LocationId) : ''
                });
              }
            }
          });
        } catch (contractErr) {
          console.warn('[mb-purchases] /client/clientcontracts failed:', contractErr.message);
        }
      } catch (err3) {
        console.warn('[mb-purchases] /client/clientservices failed:', err3.message);
      }
    }

    console.log('[mb-purchases] Returning', purchases.length, 'purchases total');
    return jsonResponse(200, { purchases: purchases, total: purchases.length });
  } catch (err) {
    console.error('[mb-purchases] Fatal error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

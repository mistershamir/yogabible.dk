/**
 * Netlify Function: GET /.netlify/functions/mb-purchases
 * Fetches client purchase history / receipts from Mindbody.
 *
 * Query params:
 *   clientId (required) - Mindbody client ID
 *   startDate (YYYY-MM-DD) - defaults to 365 days ago
 *   endDate (YYYY-MM-DD) - defaults to today
 *
 * Uses /client/clientservices and /client/clientcontracts — the only
 * reliable per-client endpoints. /sale/sales does NOT filter by ClientId.
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

    // ── Fetch client services (passes, clip cards, etc.) ──
    try {
      console.log('[mb-purchases] Fetching /client/clientservices for clientId:', params.clientId);
      var svcData = await mbFetch('/client/clientservices?ClientId=' + params.clientId + '&CrossRegionalLookup=false');
      var services = svcData.ClientServices || [];
      console.log('[mb-purchases] Found', services.length, 'client services');

      // Log first service for debugging field names
      if (services.length > 0) {
        console.log('[mb-purchases] Sample service keys:', Object.keys(services[0]).join(', '));
        console.log('[mb-purchases] Sample service:', JSON.stringify(services[0]).substring(0, 500));
      }

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
          price: svc.Price || svc.OnlinePrice || 0,
          amountPaid: svc.Price || svc.OnlinePrice || 0,
          discount: 0,
          tax: 0,
          returned: false,
          quantity: 1,
          paymentMethod: '',
          paymentLast4: '',
          locationName: svc.Location ? svc.Location.Name : '',
          type: 'service',
          remaining: typeof svc.Remaining === 'number' ? svc.Remaining : null,
          count: svc.Count || null,
          current: svc.Current || false,
          expirationDate: svc.ExpirationDate || null,
          programName: svc.Program ? svc.Program.Name : ''
        });
      });
    } catch (svcErr) {
      console.warn('[mb-purchases] /client/clientservices failed:', svcErr.message);
    }

    // ── Fetch client contracts (memberships) ──
    try {
      console.log('[mb-purchases] Fetching /client/clientcontracts for clientId:', params.clientId);
      var contractData = await mbFetch('/client/clientcontracts?ClientId=' + params.clientId);
      var contracts = contractData.Contracts || [];
      console.log('[mb-purchases] Found', contracts.length, 'client contracts');

      if (contracts.length > 0) {
        console.log('[mb-purchases] Sample contract keys:', Object.keys(contracts[0]).join(', '));
        console.log('[mb-purchases] Sample contract:', JSON.stringify(contracts[0]).substring(0, 500));
      }

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
          serviceName: c.Name || c.ContractName || '',
          price: c.TotalAmount || c.AutopayAmount || 0,
          amountPaid: c.TotalAmount || c.AutopayAmount || 0,
          discount: 0,
          tax: 0,
          returned: false,
          quantity: 1,
          paymentMethod: c.AutopayStatus === 'Active' ? 'Autopay' : '',
          paymentLast4: '',
          locationName: c.LocationId ? ('Location ' + c.LocationId) : '',
          type: 'contract',
          contractEndDate: c.EndDate || null,
          autopayStatus: c.AutopayStatus || null,
          autopayAmount: c.AutopayAmount || 0
        });
      });
    } catch (contractErr) {
      console.warn('[mb-purchases] /client/clientcontracts failed:', contractErr.message);
    }

    console.log('[mb-purchases] Returning', purchases.length, 'purchases for clientId', params.clientId);
    return jsonResponse(200, { purchases: purchases, total: purchases.length });
  } catch (err) {
    console.error('[mb-purchases] Fatal error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

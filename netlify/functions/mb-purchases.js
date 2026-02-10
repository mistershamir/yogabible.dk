/**
 * Netlify Function: GET /.netlify/functions/mb-purchases
 * Fetches client purchase history / receipts from Mindbody.
 *
 * Query params:
 *   clientId (required) - Mindbody client ID
 *   startDate (YYYY-MM-DD) - defaults to 730 days ago (2 years)
 *   endDate (YYYY-MM-DD) - defaults to today
 *
 * Strategy:
 *   1. Fetch /sale/sales (rich data: payments, tax, line items)
 *      - ClientId filter is broken, so fetch all + filter server-side
 *   2. ALSO fetch /client/clientservices + /client/clientcontracts
 *   3. Merge: use /sale/sales data when available, supplement with services/contracts
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

    var clientId = params.clientId;
    var now = new Date();
    var startDate = params.startDate || new Date(now.getTime() - 730 * 86400000).toISOString().split('T')[0];
    var endDate = params.endDate || now.toISOString().split('T')[0];

    // ══════════════════════════════════════
    // Fetch ALL data sources in parallel
    // ══════════════════════════════════════

    var debugLog = [];
    var salesPromise = fetchSales(startDate, endDate, clientId, debugLog);
    var servicesPromise = fetchClientServices(clientId, startDate, endDate, debugLog);
    var contractsPromise = fetchClientContracts(clientId, startDate, endDate, debugLog);

    var results = await Promise.all([salesPromise, servicesPromise, contractsPromise]);
    var salesPurchases = results[0];
    var servicesPurchases = results[1];
    var contractsPurchases = results[2];

    console.log('[mb-purchases] Results: sales=' + salesPurchases.length +
      ', services=' + servicesPurchases.length +
      ', contracts=' + contractsPurchases.length);

    // ══════════════════════════════════════
    // Merge: prefer /sale/sales (has payment data), supplement with services/contracts
    // ══════════════════════════════════════

    var purchases = [];
    var seenIds = {};

    // First: add all sale-based purchases (rich data)
    salesPurchases.forEach(function(p) {
      purchases.push(p);
      seenIds['sale-' + p.saleId] = true;
    });

    // Then: add services/contracts not already covered by sales
    servicesPurchases.concat(contractsPurchases).forEach(function(p) {
      // Avoid duplicates — check by description + date match
      var isDup = false;
      purchases.forEach(function(existing) {
        if (existing.description === p.description &&
            existing.saleDate.split('T')[0] === p.saleDate.split('T')[0]) {
          isDup = true;
        }
      });
      if (!isDup) {
        purchases.push(p);
      }
    });

    // Sort newest first
    purchases.sort(function(a, b) { return new Date(b.saleDate) - new Date(a.saleDate); });

    console.log('[mb-purchases] Returning', purchases.length, 'total purchases for clientId', clientId);
    return jsonResponse(200, {
      purchases: purchases,
      total: purchases.length,
      _debug: debugLog
    });
  } catch (err) {
    console.error('[mb-purchases] Fatal error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};


// ══════════════════════════════════════
// Data source 1: /sale/sales (rich invoice data)
// ══════════════════════════════════════
async function fetchSales(startDate, endDate, clientId, debugLog) {
  var purchases = [];
  try {
    var offset = 0;
    var limit = 200;
    var hasMore = true;
    var totalSales = 0;
    var matchedSales = 0;
    var seenClientIds = {};

    while (hasMore) {
      var salesUrl = '/sale/sales?StartSaleDateTime=' + startDate +
        'T00:00:00&EndSaleDateTime=' + endDate +
        'T23:59:59&Limit=' + limit + '&Offset=' + offset;

      console.log('[mb-purchases] Fetching', salesUrl);
      var salesData = await mbFetch(salesUrl);
      var batch = salesData.Sales || [];
      totalSales += batch.length;

      if (offset === 0) {
        if (batch.length > 0) {
          debugLog.push({ type: 'FIRST_SALE', keys: Object.keys(batch[0]), data: JSON.parse(JSON.stringify(batch[0])) });

          var items = batch[0].PurchasedItems || batch[0].Items || [];
          if (items.length > 0) {
            debugLog.push({ type: 'FIRST_SALE_ITEM', keys: Object.keys(items[0]), data: items[0] });
          }
          var payments = batch[0].Payments || [];
          if (payments.length > 0) {
            debugLog.push({ type: 'FIRST_SALE_PAYMENT', keys: Object.keys(payments[0]), data: payments[0] });
          }
        } else {
          debugLog.push({ type: 'SALES_EMPTY', message: 'No sales returned from /sale/sales', url: salesUrl });
        }

        batch.forEach(function(s) {
          var cid = String(s.ClientId || '');
          if (!seenClientIds[cid]) seenClientIds[cid] = 0;
          seenClientIds[cid]++;
        });
      }

      batch.forEach(function(sale) {
        var saleClientId = String(sale.ClientId || '');
        if (saleClientId === String(clientId)) {
          matchedSales++;
          purchases.push(mapSaleToPurchase(sale));
        }
      });

      var pagination = salesData.PaginationResponse || {};
      var totalResults = pagination.TotalResults || 0;
      offset += limit;

      if (batch.length < limit || offset >= totalResults) hasMore = false;
      if (offset >= 1000) hasMore = false;
    }

    var summary = 'total=' + totalSales + ', matched=' + matchedSales + ', clientIds=' + JSON.stringify(seenClientIds);
    console.log('[mb-purchases] /sale/sales SUMMARY:', summary);
    debugLog.push({ type: 'SALES_SUMMARY', totalSales: totalSales, matchedSales: matchedSales, uniqueClientIds: seenClientIds });

  } catch (err) {
    console.error('[mb-purchases] /sale/sales FAILED:', err.message);
    debugLog.push({ type: 'SALES_ERROR', error: err.message, status: err.status || null });
  }
  return purchases;
}

function mapSaleToPurchase(sale) {
  var saleId = sale.SaleId || sale.Id;
  var items = sale.PurchasedItems || sale.Items || [];
  var payments = sale.Payments || [];
  var saleDate = sale.SaleDateTime || sale.SaleDate || '';

  var paymentDetails = payments.map(function(p) {
    return {
      method: p.PaymentMethodName || p.Type || '',
      last4: p.PaymentLastFour || p.LastFour || '',
      amount: p.PaymentAmountPaid || p.Amount || 0,
      notes: p.PaymentNotes || p.Notes || ''
    };
  });

  var primaryPayment = paymentDetails[0] || {};

  var lineItems = items.map(function(item) {
    var unitPrice = item.Price || item.UnitPrice || item.AmountPaid || item.Amount || item.RetailPrice || 0;
    var amountPaid = item.AmountPaid || item.Amount || item.Price || item.TotalAmount || 0;

    return {
      id: item.Id || item.ItemId || 0,
      description: item.Description || item.Name || '',
      quantity: item.Quantity || 1,
      unitPrice: unitPrice,
      amountPaid: amountPaid,
      discount: item.AmountDiscounted || item.Discount || 0,
      tax: item.Tax || item.TaxAmount || 0,
      returned: item.Returned || false,
      type: item.Type || ''
    };
  });

  var subtotal = 0, totalTax = 0, totalDiscount = 0, totalPaid = 0, anyReturned = false;
  lineItems.forEach(function(li) {
    subtotal += li.unitPrice * li.quantity;
    totalTax += li.tax;
    totalDiscount += li.discount;
    totalPaid += li.amountPaid;
    if (li.returned) anyReturned = true;
  });

  var saleTotalPaid = sale.TotalAmountPaid || sale.TotalAmount || sale.AmountPaid || sale.Total || totalPaid;

  return {
    saleId: saleId,
    saleDate: saleDate,
    description: lineItems.length === 1
      ? lineItems[0].description
      : lineItems.map(function(li) { return li.description; }).join(', '),
    items: lineItems,
    payments: paymentDetails,
    paymentMethod: primaryPayment.method || '',
    paymentLast4: primaryPayment.last4 || '',
    paymentNotes: primaryPayment.notes || '',
    subtotal: subtotal,
    tax: totalTax,
    discount: totalDiscount,
    totalPaid: saleTotalPaid,
    returned: anyReturned,
    locationName: sale.Location ? sale.Location.Name : '',
    soldBy: sale.SoldByName || '',
    source: 'sale'
  };
}


// ══════════════════════════════════════
// Data source 2: /client/clientservices
// ══════════════════════════════════════
async function fetchClientServices(clientId, startDate, endDate, debugLog) {
  var purchases = [];
  try {
    var svcData = await mbFetch('/client/clientservices?ClientId=' + clientId + '&CrossRegionalLookup=false');
    var services = svcData.ClientServices || [];

    if (services.length > 0) {
      debugLog.push({ type: 'FIRST_SERVICE', keys: Object.keys(services[0]), data: JSON.parse(JSON.stringify(services[0])) });
    }

    services.forEach(function(svc) {
      var activeDate = svc.ActiveDate || svc.SaleDate || '';
      if (!activeDate) return;
      var svcDate = activeDate.split('T')[0];
      if (svcDate < startDate || svcDate > endDate) return;

      // Try every known price field
      var price = svc.Price || svc.OnlinePrice || svc.RetailPrice || svc.Cost || svc.Amount || svc.AmountPaid || svc.TotalAmount || 0;

      purchases.push({
        saleId: svc.Id,
        saleDate: activeDate,
        description: svc.Name || '',
        items: [{
          description: svc.Name || '',
          quantity: 1,
          unitPrice: price,
          amountPaid: price,
          discount: 0,
          tax: 0,
          returned: false
        }],
        payments: [],
        paymentMethod: '',
        paymentLast4: '',
        subtotal: price,
        tax: 0,
        discount: 0,
        totalPaid: price,
        returned: false,
        remaining: typeof svc.Remaining === 'number' ? svc.Remaining : null,
        count: svc.Count || null,
        current: svc.Current || false,
        expirationDate: svc.ExpirationDate || null,
        programName: svc.Program ? svc.Program.Name : '',
        source: 'clientservice'
      });
    });
  } catch (e) {
    console.warn('[mb-purchases] clientservices failed:', e.message);
  }
  return purchases;
}


// ══════════════════════════════════════
// Data source 3: /client/clientcontracts
// ══════════════════════════════════════
async function fetchClientContracts(clientId, startDate, endDate, debugLog) {
  var purchases = [];
  try {
    var contractData = await mbFetch('/client/clientcontracts?ClientId=' + clientId);
    var contracts = contractData.Contracts || [];

    if (contracts.length > 0) {
      debugLog.push({ type: 'FIRST_CONTRACT', keys: Object.keys(contracts[0]), data: JSON.parse(JSON.stringify(contracts[0])) });
    }

    contracts.forEach(function(c) {
      var cDate = c.AgreementDate || c.StartDate || '';
      if (!cDate) return;
      var contractDate = cDate.split('T')[0];
      if (contractDate < startDate || contractDate > endDate) return;

      var price = c.TotalAmount || c.AutopayAmount || c.ContractPrice || c.Price || c.Amount || 0;

      purchases.push({
        saleId: c.Id,
        saleDate: cDate,
        description: c.Name || c.ContractName || '',
        items: [{
          description: c.Name || c.ContractName || '',
          quantity: 1,
          unitPrice: price,
          amountPaid: price,
          discount: 0,
          tax: 0,
          returned: false
        }],
        payments: [],
        paymentMethod: c.AutopayStatus === 'Active' ? 'Autopay' : '',
        paymentLast4: '',
        subtotal: price,
        tax: 0,
        discount: 0,
        totalPaid: price,
        returned: false,
        contractEndDate: c.EndDate || null,
        autopayAmount: c.AutopayAmount || 0,
        source: 'clientcontract'
      });
    });
  } catch (e) {
    console.warn('[mb-purchases] clientcontracts failed:', e.message);
  }
  return purchases;
}

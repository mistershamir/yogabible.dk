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
 *      - Must match BOTH ClientId AND RecipientClientId
 *   2. ALSO fetch /client/clientservices + /client/clientcontracts
 *   3. Merge: use /sale/sales data when available, supplement with services/contracts
 *   4. Cross-reference services with sales to get price data (services have no price field)
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

    // For /sale/sales, use narrower window (last 365 days) to avoid pagination limits
    var salesStartDate = params.startDate || new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0];

    // ══════════════════════════════════════
    // Fetch ALL data sources in parallel
    // ══════════════════════════════════════

    var salesPromise = fetchSales(salesStartDate, endDate, clientId);
    var servicesPromise = fetchClientServices(clientId, startDate, endDate);
    var contractsPromise = fetchClientContracts(clientId, startDate, endDate);

    var results = await Promise.all([salesPromise, servicesPromise, contractsPromise]);
    var salesPurchases = results[0];
    var servicesPurchases = results[1];
    var contractsPurchases = results[2];

    console.log('[mb-purchases] Results: sales=' + salesPurchases.length +
      ', services=' + servicesPurchases.length +
      ', contracts=' + contractsPurchases.length);

    // ══════════════════════════════════════
    // Cross-reference: enrich services with sale price data
    // ══════════════════════════════════════
    enrichServicesWithSaleData(servicesPurchases, salesPurchases);

    // ══════════════════════════════════════
    // Merge: prefer /sale/sales (has payment data), supplement with services/contracts
    // ══════════════════════════════════════

    var purchases = [];
    var seenDescDates = {};

    // First: add all sale-based purchases (rich data)
    salesPurchases.forEach(function(p) {
      purchases.push(p);
      var key = (p.description || '').toLowerCase() + '|' + (p.saleDate || '').split('T')[0];
      seenDescDates[key] = true;
    });

    // Then: add services/contracts not already covered by sales
    servicesPurchases.concat(contractsPurchases).forEach(function(p) {
      var key = (p.description || '').toLowerCase() + '|' + (p.saleDate || '').split('T')[0];
      if (!seenDescDates[key]) {
        purchases.push(p);
        seenDescDates[key] = true;
      }
    });

    // Sort newest first
    purchases.sort(function(a, b) { return new Date(b.saleDate) - new Date(a.saleDate); });

    console.log('[mb-purchases] Returning', purchases.length, 'total purchases for clientId', clientId);
    return jsonResponse(200, {
      purchases: purchases,
      total: purchases.length
    });
  } catch (err) {
    console.error('[mb-purchases] Fatal error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};


// ══════════════════════════════════════
// Data source 1: /sale/sales (rich invoice data)
// ══════════════════════════════════════
async function fetchSales(startDate, endDate, clientId) {
  var purchases = [];
  try {
    var offset = 0;
    var limit = 200;
    var hasMore = true;
    var totalSales = 0;
    var matchedSales = 0;

    while (hasMore) {
      var salesUrl = '/sale/sales?StartSaleDateTime=' + startDate +
        'T00:00:00&EndSaleDateTime=' + endDate +
        'T23:59:59&Limit=' + limit + '&Offset=' + offset;

      console.log('[mb-purchases] Fetching', salesUrl);
      var salesData = await mbFetch(salesUrl);
      var batch = salesData.Sales || [];
      totalSales += batch.length;

      batch.forEach(function(sale) {
        // Match by BOTH ClientId AND RecipientClientId (MB uses them inconsistently)
        var saleClientId = String(sale.ClientId || '');
        var recipientId = String(sale.RecipientClientId || '');
        var targetId = String(clientId);

        if (saleClientId === targetId || recipientId === targetId) {
          matchedSales++;
          purchases.push(mapSaleToPurchase(sale));
        }
      });

      var pagination = salesData.PaginationResponse || {};
      var totalResults = pagination.TotalResults || 0;
      offset += limit;

      if (batch.length < limit || offset >= totalResults) hasMore = false;
      // Increase limit to 2000 to catch more recent sales
      if (offset >= 2000) hasMore = false;
    }

    console.log('[mb-purchases] /sale/sales SUMMARY: total=' + totalSales + ', matched=' + matchedSales);

  } catch (err) {
    console.error('[mb-purchases] /sale/sales FAILED:', err.message);
  }
  return purchases;
}

function mapSaleToPurchase(sale) {
  var saleId = sale.Id || sale.SaleId;
  var items = sale.PurchasedItems || sale.Items || [];
  var payments = sale.Payments || [];
  var saleDate = sale.SaleDateTime || sale.SaleDate || '';

  // Map payments — confirmed field names from debug: Amount, Type, Method, TransactionId, Last4
  var paymentDetails = payments.map(function(p) {
    return {
      method: p.Type || p.PaymentMethodName || '',
      last4: p.Last4 || p.PaymentLastFour || '',
      amount: Number(p.Amount) || Number(p.PaymentAmountPaid) || 0,
      transactionId: p.TransactionId || null,
      notes: p.Notes || p.PaymentNotes || ''
    };
  });

  var primaryPayment = paymentDetails[0] || {};

  // Map line items — confirmed field names from debug: UnitPrice, TotalAmount, TaxAmount, DiscountAmount, Quantity
  var lineItems = items.map(function(item) {
    var unitPrice = Number(item.UnitPrice) || Number(item.Price) || Number(item.RetailPrice) || 0;
    var totalAmount = Number(item.TotalAmount) || Number(item.AmountPaid) || Number(item.Amount) || unitPrice;
    var taxAmount = Number(item.TaxAmount) || Number(item.Tax) || 0;
    // Also sum Tax1-Tax5 if TaxAmount is zero
    if (taxAmount === 0) {
      taxAmount = (Number(item.Tax1) || 0) + (Number(item.Tax2) || 0) +
        (Number(item.Tax3) || 0) + (Number(item.Tax4) || 0) + (Number(item.Tax5) || 0);
    }
    var discountAmount = Number(item.DiscountAmount) || Number(item.AmountDiscounted) || Number(item.Discount) || 0;

    return {
      id: item.Id || item.ItemId || 0,
      description: item.Description || item.Name || '',
      quantity: Number(item.Quantity) || 1,
      unitPrice: unitPrice,
      amountPaid: totalAmount,
      discount: discountAmount,
      discountPercent: Number(item.DiscountPercent) || 0,
      tax: taxAmount,
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

  // Use the total from payments if available, otherwise from items
  var paymentTotal = 0;
  paymentDetails.forEach(function(pd) { paymentTotal += pd.amount; });
  var saleTotalPaid = paymentTotal > 0 ? paymentTotal : (totalPaid || subtotal);

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
// NOTE: ClientServices have NO price field — prices come from cross-referencing with sales
// ══════════════════════════════════════
async function fetchClientServices(clientId, startDate, endDate) {
  var purchases = [];
  try {
    var svcData = await mbFetch('/client/clientservices?ClientId=' + clientId + '&CrossRegionalLookup=false');
    var services = svcData.ClientServices || [];

    services.forEach(function(svc) {
      var activeDate = svc.ActiveDate || svc.SaleDate || '';
      if (!activeDate) return;
      var svcDate = activeDate.split('T')[0];
      if (svcDate < startDate || svcDate > endDate) return;

      purchases.push({
        saleId: svc.Id,
        saleDate: activeDate,
        description: svc.Name || '',
        productId: svc.ProductId || null,
        items: [{
          description: svc.Name || '',
          quantity: 1,
          unitPrice: 0,
          amountPaid: 0,
          discount: 0,
          tax: 0,
          returned: svc.Returned || false
        }],
        payments: [],
        paymentMethod: '',
        paymentLast4: '',
        subtotal: 0,
        tax: 0,
        discount: 0,
        totalPaid: 0,
        returned: svc.Returned || false,
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
// Price is in UpcomingAutopayEvents[0].ChargeAmount (not top-level fields)
// ══════════════════════════════════════
async function fetchClientContracts(clientId, startDate, endDate) {
  var purchases = [];
  try {
    var contractData = await mbFetch('/client/clientcontracts?ClientId=' + clientId);
    var contracts = contractData.Contracts || [];

    contracts.forEach(function(c) {
      var cDate = c.AgreementDate || c.StartDate || '';
      if (!cDate) return;
      var contractDate = cDate.split('T')[0];
      if (contractDate < startDate || contractDate > endDate) return;

      // Extract price from UpcomingAutopayEvents (confirmed working from debug)
      var events = c.UpcomingAutopayEvents || [];
      var firstEvent = events[0] || {};
      var price = Number(firstEvent.ChargeAmount) || Number(firstEvent.Subtotal) || 0;
      var tax = Number(firstEvent.Tax) || 0;
      var payMethod = firstEvent.PaymentMethod || '';

      // Fallback to top-level fields if events are empty
      if (price === 0) {
        price = Number(c.TotalAmount) || Number(c.AutopayAmount) || Number(c.ContractPrice) || 0;
      }

      purchases.push({
        saleId: c.Id,
        saleDate: cDate,
        description: c.Name || c.ContractName || '',
        items: [{
          description: c.Name || c.ContractName || '',
          quantity: 1,
          unitPrice: price,
          amountPaid: price + tax,
          discount: 0,
          tax: tax,
          returned: false
        }],
        payments: payMethod ? [{ method: payMethod, last4: '', amount: price + tax, notes: '' }] : [],
        paymentMethod: payMethod || (c.AutopayStatus === 'Active' ? 'Autopay' : ''),
        paymentLast4: '',
        subtotal: price,
        tax: tax,
        discount: 0,
        totalPaid: price + tax,
        returned: false,
        contractEndDate: c.EndDate || null,
        autopayAmount: Number(c.AutopayAmount) || 0,
        source: 'clientcontract'
      });
    });
  } catch (e) {
    console.warn('[mb-purchases] clientcontracts failed:', e.message);
  }
  return purchases;
}


// ══════════════════════════════════════
// Cross-reference: enrich services with price data from matching sales
// Services have ProductId but no price — sales have both
// ══════════════════════════════════════
function enrichServicesWithSaleData(services, sales) {
  if (!sales.length) return;

  // Build a lookup: description (lowercase) + date → sale data
  var saleLookup = {};
  sales.forEach(function(sale) {
    if (!sale.items) return;
    sale.items.forEach(function(item) {
      var key = (item.description || '').toLowerCase();
      if (!saleLookup[key]) {
        saleLookup[key] = {
          unitPrice: item.unitPrice,
          amountPaid: item.amountPaid,
          tax: item.tax,
          discount: item.discount,
          payments: sale.payments,
          paymentMethod: sale.paymentMethod,
          totalPaid: sale.totalPaid
        };
      }
    });
  });

  // Enrich services that have 0 price
  services.forEach(function(svc) {
    if (svc.totalPaid > 0) return; // Already has price

    var key = (svc.description || '').toLowerCase();
    var match = saleLookup[key];
    if (match) {
      svc.items[0].unitPrice = match.unitPrice;
      svc.items[0].amountPaid = match.amountPaid;
      svc.items[0].tax = match.tax;
      svc.items[0].discount = match.discount;
      svc.subtotal = match.unitPrice;
      svc.tax = match.tax;
      svc.discount = match.discount;
      svc.totalPaid = match.amountPaid;
      svc.payments = match.payments || [];
      svc.paymentMethod = match.paymentMethod || '';
      svc.priceSource = 'cross-ref-sale';
    }
  });
}

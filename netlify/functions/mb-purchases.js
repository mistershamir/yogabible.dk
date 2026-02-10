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
 *   1. Fetch /sale/sales with date range (returns ALL sales — ClientId filter broken)
 *   2. Filter server-side by ClientId
 *   3. Enrich with data from /client/clientservices and /client/clientcontracts
 *   4. Return rich invoice data: items, payments, tax, discount, etc.
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

    // ── Fetch /sale/sales (rich invoice data) ──
    // ClientId filter is broken on this endpoint, so we fetch by date range
    // and filter server-side. Paginate to get all results.
    var sales = [];
    try {
      var offset = 0;
      var limit = 200;
      var hasMore = true;

      while (hasMore) {
        var salesUrl = '/sale/sales?StartSaleDateTime=' + startDate +
          'T00:00:00&EndSaleDateTime=' + endDate +
          'T23:59:59&Limit=' + limit + '&Offset=' + offset;

        console.log('[mb-purchases] Fetching', salesUrl);
        var salesData = await mbFetch(salesUrl);
        var batch = salesData.Sales || [];
        console.log('[mb-purchases] Got', batch.length, 'sales (offset=' + offset + ')');

        // Filter by ClientId server-side
        batch.forEach(function(sale) {
          var saleClientId = String(sale.ClientId || '');
          if (saleClientId === String(clientId)) {
            sales.push(sale);
          }
        });

        // Check pagination
        var pagination = salesData.PaginationResponse || {};
        var totalResults = pagination.TotalResults || 0;
        offset += limit;

        // Stop if no more results or we've fetched all pages
        if (batch.length < limit || offset >= totalResults) {
          hasMore = false;
        }

        // Safety: max 5 pages (1000 sales) to prevent runaway
        if (offset >= 1000) {
          console.log('[mb-purchases] Hit 1000-sale safety limit');
          hasMore = false;
        }
      }

      console.log('[mb-purchases] Found', sales.length, 'sales for clientId', clientId);

      // Log first sale FULLY for debugging
      if (sales.length > 0) {
        console.log('[mb-purchases] FULL first sale:', JSON.stringify(sales[0]).substring(0, 2000));
        console.log('[mb-purchases] Sample sale keys:', Object.keys(sales[0]).join(', '));
        var firstItems = sales[0].PurchasedItems || sales[0].Items || [];
        if (firstItems.length > 0) {
          console.log('[mb-purchases] FULL first item:', JSON.stringify(firstItems[0]));
          console.log('[mb-purchases] Sample item keys:', Object.keys(firstItems[0]).join(', '));
        }
        var firstPayments = sales[0].Payments || [];
        if (firstPayments.length > 0) {
          console.log('[mb-purchases] FULL first payment:', JSON.stringify(firstPayments[0]));
          console.log('[mb-purchases] Sample payment keys:', Object.keys(firstPayments[0]).join(', '));
        }
      }
    } catch (salesErr) {
      console.warn('[mb-purchases] /sale/sales failed:', salesErr.message);
    }

    // ── Build purchases array from sales data ──
    var purchases = [];
    var saleIdsSeen = {};

    sales.forEach(function(sale) {
      var saleId = sale.SaleId || sale.Id;
      if (saleIdsSeen[saleId]) return; // skip duplicates
      saleIdsSeen[saleId] = true;

      var items = sale.PurchasedItems || sale.Items || [];
      var payments = sale.Payments || [];
      var saleDate = sale.SaleDateTime || sale.SaleDate || '';

      // Extract payment info
      var paymentDetails = payments.map(function(p) {
        return {
          method: p.PaymentMethodName || p.Type || '',
          last4: p.PaymentLastFour || p.LastFour || '',
          amount: p.PaymentAmountPaid || p.Amount || 0,
          notes: p.PaymentNotes || p.Notes || ''
        };
      });

      // Primary payment for summary
      var primaryPayment = paymentDetails[0] || {};

      // Build line items — try every known field name variant
      var lineItems = items.map(function(item) {
        // Price: try every possible field
        var unitPrice = item.Price || item.UnitPrice || item.AmountPaid || item.Amount || item.RetailPrice || 0;
        var amountPaid = item.AmountPaid || item.Amount || item.Price || item.TotalAmount || 0;
        var discount = item.AmountDiscounted || item.Discount || item.DiscountAmount || 0;
        var tax = item.Tax || item.TaxAmount || item.TaxRate || 0;

        return {
          id: item.Id || item.ItemId || 0,
          description: item.Description || item.Name || item.ItemName || '',
          quantity: item.Quantity || item.Qty || 1,
          unitPrice: unitPrice,
          amountPaid: amountPaid,
          discount: discount,
          tax: tax,
          returned: item.Returned || item.IsReturned || false,
          type: item.Type || item.ItemType || '',
          isService: item.IsService || false,
          _raw: item  // pass through raw for debugging
        };
      });

      // Calculate totals from items
      var subtotal = 0;
      var totalTax = 0;
      var totalDiscount = 0;
      var totalPaid = 0;
      var anyReturned = false;

      lineItems.forEach(function(li) {
        subtotal += li.unitPrice * li.quantity;
        totalTax += li.tax;
        totalDiscount += li.discount;
        totalPaid += li.amountPaid;
        if (li.returned) anyReturned = true;
      });

      // Use sale-level total — try every possible field name
      var saleTotalPaid = sale.TotalAmountPaid || sale.TotalAmount || sale.AmountPaid || sale.Total || totalPaid;

      purchases.push({
        saleId: saleId,
        saleDate: saleDate,
        clientId: String(sale.ClientId || ''),
        locationId: sale.LocationId || null,
        locationName: sale.Location ? sale.Location.Name : '',
        soldBy: sale.SoldByName || '',
        // Item summary (first item name for the card title)
        description: lineItems.length === 1
          ? lineItems[0].description
          : lineItems.map(function(li) { return li.description; }).join(', '),
        // Full line items for invoice
        items: lineItems,
        // Payment details
        payments: paymentDetails,
        paymentMethod: primaryPayment.method || '',
        paymentLast4: primaryPayment.last4 || '',
        paymentNotes: primaryPayment.notes || '',
        // Totals
        subtotal: subtotal,
        tax: totalTax,
        discount: totalDiscount,
        totalPaid: saleTotalPaid,
        returned: anyReturned,
        quantity: lineItems.length,
        // DEBUG: raw sale-level keys and values for price discovery
        _debug: {
          saleKeys: Object.keys(sale).join(','),
          salePriceFields: (function() {
            var pf = {};
            Object.keys(sale).forEach(function(k) {
              var v = sale[k];
              if (typeof v === 'number' || (typeof v === 'string' && !isNaN(v) && v.length < 20 && v !== '')) {
                pf[k] = v;
              }
            });
            return pf;
          })(),
          firstItemRaw: items.length > 0 ? items[0] : null,
          firstPaymentRaw: payments.length > 0 ? payments[0] : null
        }
      });
    });

    // ── Fallback: fetch client services + contracts if /sale/sales returned nothing ──
    if (purchases.length === 0) {
      console.log('[mb-purchases] No sales found, falling back to clientservices + clientcontracts');

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
            items: [{ description: svc.Name || '', quantity: 1, unitPrice: svc.Price || 0, amountPaid: svc.Price || 0, discount: 0, tax: 0, returned: false }],
            payments: [],
            paymentMethod: '',
            paymentLast4: '',
            subtotal: svc.Price || 0,
            tax: 0,
            discount: 0,
            totalPaid: svc.Price || 0,
            returned: false,
            remaining: typeof svc.Remaining === 'number' ? svc.Remaining : null,
            count: svc.Count || null,
            current: svc.Current || false,
            expirationDate: svc.ExpirationDate || null,
            type: 'service',
            _fallback: true
          });
        });
      } catch (e) { console.warn('[mb-purchases] clientservices fallback failed:', e.message); }

      try {
        var contractData = await mbFetch('/client/clientcontracts?ClientId=' + clientId);
        var contracts = contractData.Contracts || [];
        contracts.forEach(function(c) {
          var cDate = c.AgreementDate || c.StartDate || '';
          if (!cDate) return;
          var contractDate = cDate.split('T')[0];
          if (contractDate < startDate || contractDate > endDate) return;

          purchases.push({
            saleId: c.Id,
            saleDate: cDate,
            description: c.Name || c.ContractName || '',
            items: [{ description: c.Name || c.ContractName || '', quantity: 1, unitPrice: c.TotalAmount || c.AutopayAmount || 0, amountPaid: c.TotalAmount || c.AutopayAmount || 0, discount: 0, tax: 0, returned: false }],
            payments: [],
            paymentMethod: c.AutopayStatus === 'Active' ? 'Autopay' : '',
            paymentLast4: '',
            subtotal: c.TotalAmount || c.AutopayAmount || 0,
            tax: 0,
            discount: 0,
            totalPaid: c.TotalAmount || c.AutopayAmount || 0,
            returned: false,
            type: 'contract',
            _fallback: true
          });
        });
      } catch (e) { console.warn('[mb-purchases] clientcontracts fallback failed:', e.message); }
    }

    // Sort newest first
    purchases.sort(function(a, b) { return new Date(b.saleDate) - new Date(a.saleDate); });

    // Log first purchase to debug field mapping
    if (purchases.length > 0) {
      console.log('[mb-purchases] First purchase output:', JSON.stringify(purchases[0]).substring(0, 1000));
    }

    console.log('[mb-purchases] Returning', purchases.length, 'purchases for clientId', clientId);
    return jsonResponse(200, { purchases: purchases, total: purchases.length });
  } catch (err) {
    console.error('[mb-purchases] Fatal error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

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

const { mbFetch, clearTokenCache, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  console.log('[mb-contracts] Method:', event.httpMethod, 'Path:', event.path);

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
          autopaySchedule: (c.AutopaySchedule && typeof c.AutopaySchedule === 'object')
            ? (c.AutopaySchedule.FrequencyType || c.AutopaySchedule.Description || JSON.stringify(c.AutopaySchedule))
            : (c.AutopaySchedule || ''),
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

  // POST: Purchase a contract OR manage (terminate/suspend)
  if (event.httpMethod === 'POST') {
    try {
      var body = JSON.parse(event.body || '{}');
      console.log('[mb-contracts] POST action:', body.action || 'purchase', 'clientId:', body.clientId);

      // ── Route: manage actions (terminate / suspend) ──
      if (body.action === 'terminate' || body.action === 'suspend') {
        // Force fresh token for contract management (staff permissions may have changed)
        clearTokenCache();

        if (!body.clientId || !body.clientContractId) {
          return jsonResponse(400, { error: 'clientId and clientContractId are required' });
        }

        if (body.action === 'terminate') {
          if (!body.terminationDate) {
            return jsonResponse(400, { error: 'terminationDate is required for termination' });
          }

          var terminateBody = {
            ClientId: body.clientId,
            ClientContractId: body.clientContractId,
            TerminationDate: body.terminationDate,
            SendNotifications: true
          };

          if (body.terminationCode) {
            terminateBody.TerminationCode = body.terminationCode;
          }

          console.log('[mb-contracts] Terminating:', JSON.stringify({
            ClientId: terminateBody.ClientId,
            ClientContractId: terminateBody.ClientContractId,
            TerminationDate: terminateBody.TerminationDate
          }));

          // Try endpoint paths in order — MB v6 docs put this under Sale category
          var terminatePaths = ['/sale/terminatecontract', '/contract/terminatecontract', '/client/terminatecontract'];
          var lastTermErr = null;
          var pathResults = []; // diagnostic trail

          for (var ti = 0; ti < terminatePaths.length; ti++) {
            try {
              console.log('[mb-contracts] Trying terminate path: ' + terminatePaths[ti]);
              var termResult = await mbFetch(terminatePaths[ti], {
                method: 'POST',
                body: JSON.stringify(terminateBody)
              });
              pathResults.push({ path: terminatePaths[ti], status: 'success' });
              lastTermErr = null;
              return jsonResponse(200, {
                success: true,
                action: 'terminate',
                terminationDate: body.terminationDate,
                endpointUsed: terminatePaths[ti],
                _pathResults: pathResults
              });
            } catch (termErr) {
              var msg = (termErr.message || '').toLowerCase();
              pathResults.push({ path: terminatePaths[ti], status: termErr.status || 'error', error: termErr.message });
              // Path doesn't exist, method not allowed, or permission denied — try next path
              if (msg.indexOf('non-json') > -1 || msg.indexOf('not exist') > -1 || termErr.status === 404 || termErr.status === 405) {
                console.log('[mb-contracts] Path ' + terminatePaths[ti] + ' failed (' + (termErr.status || 'unknown') + '), trying next...');
                lastTermErr = termErr;
              } else if (msg.indexOf('permission') > -1) {
                console.log('[mb-contracts] Permission denied on ' + terminatePaths[ti] + ', trying next path...');
                lastTermErr = termErr;
              } else {
                // Real API error — stop and return with diagnostic trail
                console.error('[mb-contracts] Real API error on ' + terminatePaths[ti] + ':', termErr.message);
                return jsonResponse(termErr.status || 500, {
                  error: termErr.message,
                  endpointTried: terminatePaths[ti],
                  _pathResults: pathResults
                });
              }
            }
          }

          // All paths failed — return error with diagnostic trail
          var finalErrMsg = lastTermErr ? lastTermErr.message : 'All terminate paths failed';
          console.error('[mb-contracts] All terminate paths failed:', JSON.stringify(pathResults));
          return jsonResponse(lastTermErr ? (lastTermErr.status || 500) : 500, {
            error: finalErrMsg,
            _pathResults: pathResults,
            _hint: 'All 3 endpoint paths failed. Check Mindbody staff permissions for the API user, or contact Mindbody API support.'
          });
        }

        if (body.action === 'suspend') {
          if (!body.startDate || !body.endDate) {
            return jsonResponse(400, { error: 'startDate and endDate are required for suspension' });
          }

          var start = new Date(body.startDate);
          var end = new Date(body.endDate);
          var durationDays = Math.round((end - start) / 86400000);

          if (durationDays < 14) {
            return jsonResponse(400, { error: 'Suspension must be at least 14 days' });
          }
          if (durationDays > 93) {
            return jsonResponse(400, { error: 'Suspension cannot exceed 3 months (93 days)' });
          }

          var suspendBody = {
            ClientId: body.clientId,
            ClientContractId: body.clientContractId,
            SuspendDate: body.startDate,
            ResumeDate: body.endDate,
            SendNotifications: true
          };

          console.log('[mb-contracts] Suspending:', JSON.stringify({
            ClientId: suspendBody.ClientId,
            ClientContractId: suspendBody.ClientContractId,
            SuspendDate: suspendBody.SuspendDate,
            ResumeDate: suspendBody.ResumeDate,
            DurationDays: durationDays
          }));

          // Try endpoint paths in order — MB v6 docs put this under Sale category
          var suspendPaths = ['/sale/suspendcontract', '/contract/suspendcontract', '/client/suspendcontract'];
          var lastSuspErr = null;
          var suspPathResults = [];

          for (var si = 0; si < suspendPaths.length; si++) {
            try {
              console.log('[mb-contracts] Trying suspend path: ' + suspendPaths[si]);
              await mbFetch(suspendPaths[si], {
                method: 'POST',
                body: JSON.stringify(suspendBody)
              });
              suspPathResults.push({ path: suspendPaths[si], status: 'success' });
              return jsonResponse(200, {
                success: true,
                action: 'suspend',
                suspendDate: body.startDate,
                resumeDate: body.endDate,
                durationDays: durationDays,
                endpointUsed: suspendPaths[si],
                _pathResults: suspPathResults
              });
            } catch (suspErr) {
              var suspMsg = (suspErr.message || '').toLowerCase();
              suspPathResults.push({ path: suspendPaths[si], status: suspErr.status || 'error', error: suspErr.message });
              if (suspMsg.indexOf('non-json') > -1 || suspMsg.indexOf('not exist') > -1 || suspErr.status === 404 || suspErr.status === 405) {
                console.log('[mb-contracts] Path ' + suspendPaths[si] + ' failed (' + (suspErr.status || 'unknown') + '), trying next...');
                lastSuspErr = suspErr;
              } else if (suspMsg.indexOf('permission') > -1) {
                console.log('[mb-contracts] Permission denied on ' + suspendPaths[si] + ', trying next path...');
                lastSuspErr = suspErr;
              } else {
                return jsonResponse(suspErr.status || 500, {
                  error: suspErr.message,
                  _pathResults: suspPathResults
                });
              }
            }
          }

          var finalSuspMsg = lastSuspErr ? lastSuspErr.message : 'All suspend paths failed';
          console.error('[mb-contracts] All suspend paths failed:', JSON.stringify(suspPathResults));
          return jsonResponse(lastSuspErr ? (lastSuspErr.status || 500) : 500, {
            error: finalSuspMsg,
            _pathResults: suspPathResults,
            _hint: 'All 3 endpoint paths failed. Check Mindbody staff permissions for the API user.'
          });
        }
      }

      // ── Route: purchase ──
      if (!body.clientId || !body.contractId) {
        return jsonResponse(400, { error: 'clientId and contractId are required' });
      }

      var purchaseBody = {
        ClientId: body.clientId,
        ContractId: body.contractId,
        LocationId: body.locationId || 1,
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

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
        // Extract autopay frequency details
        var scheduleObj = c.AutopaySchedule || {};
        var freqType = '';
        if (typeof scheduleObj === 'object') {
          freqType = scheduleObj.FrequencyType || scheduleObj.Description || JSON.stringify(scheduleObj);
        } else {
          freqType = scheduleObj;
        }
        // First payment of 0 means first period is free
        var firstPaymentRaw = c.FirstPaymentAmountSubtotal || 0;
        return {
          id: c.Id,
          name: c.Name || '',
          description: c.Description || '',
          onlineDescription: c.OnlineDescription || '',
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
          firstPaymentAmount: firstPaymentRaw,
          firstPaymentTax: c.FirstPaymentTaxAmount || null,
          firstMonthFree: firstPaymentRaw === 0,
          recurringPaymentAmount: c.RecurringPaymentAmountSubtotal || null,
          totalContractAmount: c.TotalContractAmountSubtotal || null,
          duration: c.Duration || null,
          durationUnit: c.DurationUnit || '',
          autopaySchedule: freqType,
          numberOfAutopays: c.NumberOfAutopays || null,
          locationId: c.LocationId || null,
          programIds: c.ProgramIds || [],
          membershipTypeRestrictions: c.MembershipTypeRestrictions || [],
          agreementTerms: c.AgreementTerms || '',
          requiresElectronicConfirmation: c.RequiresElectronicConfirmation || false
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

      // ── Route: manage actions (terminate / suspend / activate) ──
      if (body.action === 'terminate' || body.action === 'suspend' || body.action === 'activate') {
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

          if (isNaN(durationDays) || durationDays < 1) {
            return jsonResponse(400, { error: 'Invalid dates — could not calculate duration' });
          }
          if (durationDays < 14) {
            return jsonResponse(400, { error: 'Suspension must be at least 14 days' });
          }
          if (durationDays > 93) {
            return jsonResponse(400, { error: 'Suspension cannot exceed 3 months (93 days)' });
          }

          var ccId = Number(body.clientContractId);

          // CONFIRMED WORKING (2026-02-09):
          // POST /client/suspendcontract with SuspensionType:"Vacation", DurationUnit:"Day"
          var suspendBody = {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            Duration: durationDays,
            DurationUnit: 'Day',
            SuspensionType: 'Vacation'
          };

          console.log('[mb-contracts] Suspending — body:', JSON.stringify(suspendBody));

          var suspResult = await mbFetch('/client/suspendcontract', {
            method: 'POST',
            body: JSON.stringify(suspendBody)
          });
          console.log('[mb-contracts] Suspend SUCCESS:', JSON.stringify(suspResult).substring(0, 300));
          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays
          });
        }

        if (body.action === 'activate') {
          var activateBody = {
            ClientId: body.clientId,
            ClientContractId: body.clientContractId
          };

          console.log('[mb-contracts] Activating (revoking termination):', JSON.stringify(activateBody));

          // Try multiple endpoint paths — no documented endpoint, so we try common patterns
          var activatePaths = ['/sale/activatecontract', '/contract/activatecontract', '/client/activatecontract'];
          var lastActErr = null;
          var actPathResults = [];

          for (var ai = 0; ai < activatePaths.length; ai++) {
            try {
              console.log('[mb-contracts] Trying activate path: ' + activatePaths[ai]);
              await mbFetch(activatePaths[ai], {
                method: 'POST',
                body: JSON.stringify(activateBody)
              });
              actPathResults.push({ path: activatePaths[ai], status: 'success' });
              return jsonResponse(200, {
                success: true,
                action: 'activate',
                endpointUsed: activatePaths[ai],
                _pathResults: actPathResults
              });
            } catch (actErr) {
              var actMsg = (actErr.message || '').toLowerCase();
              actPathResults.push({ path: activatePaths[ai], status: actErr.status || 'error', error: actErr.message });
              if (actMsg.indexOf('non-json') > -1 || actMsg.indexOf('not exist') > -1 || actErr.status === 404 || actErr.status === 405) {
                console.log('[mb-contracts] Path ' + activatePaths[ai] + ' failed (' + (actErr.status || 'unknown') + '), trying next...');
                lastActErr = actErr;
              } else if (actMsg.indexOf('permission') > -1) {
                console.log('[mb-contracts] Permission denied on ' + activatePaths[ai] + ', trying next path...');
                lastActErr = actErr;
              } else {
                return jsonResponse(actErr.status || 500, {
                  error: actErr.message,
                  _pathResults: actPathResults
                });
              }
            }
          }

          console.error('[mb-contracts] All activate paths failed:', JSON.stringify(actPathResults));
          return jsonResponse(404, {
            error: 'not_available',
            _pathResults: actPathResults,
            _hint: 'Contract reactivation is not available via the Mindbody API. Reactivate from Mindbody admin or contact support.'
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

      // Electronic signature (Base64 PNG) — Mindbody auto-files under Client Documents
      if (body.clientSignature) {
        purchaseBody.ClientSignature = body.clientSignature.replace(/^data:image\/png;base64,/, '');
      }

      // Add payment if provided — StoredCard or new CreditCard
      if (body.payment) {
        if (body.payment.useStoredCard && body.payment.lastFour) {
          purchaseBody.StoredCardInfo = {
            LastFour: String(body.payment.lastFour)
          };
        } else if (body.payment.cardNumber) {
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

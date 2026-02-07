/**
 * Netlify Function: POST/DELETE /.netlify/functions/mb-book
 * Books or cancels a client from a Mindbody class.
 *
 * BOOKING GATING LOGIC:
 *   Before booking, checks if client is allowed:
 *   1. Active autopay contract (recurring membership) → allowed
 *   2. Active service/pass with remaining sessions → allowed
 *   3. Neither → rejected with "no_pass" error code
 *
 * POST body (book):
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *   test (boolean) - if true, validates without booking
 *
 * DELETE body (cancel):
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *   lateCancel (boolean) - if true, marks as late cancel
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

/**
 * Check if client has an active autopay contract or valid service.
 * Returns { allowed: true, reason: 'contract'|'service' } or { allowed: false }
 */
async function checkBookingEligibility(clientId) {
  // Check contracts first (autopay memberships)
  try {
    var contractData = await mbFetch('/client/clientcontracts?ClientId=' + clientId);
    var contracts = contractData.Contracts || [];
    var now = new Date();

    for (var i = 0; i < contracts.length; i++) {
      var c = contracts[i];
      // Active contract: not terminated, end date in the future (or no end date)
      var startDate = c.StartDate ? new Date(c.StartDate) : null;
      var endDate = c.EndDate ? new Date(c.EndDate) : null;
      var isActive = startDate && startDate <= now && (!endDate || endDate >= now);
      // AutopayStatus or IsAutoRenewing indicates recurring billing
      var isAutopay = c.IsAutoRenewing || (c.AutopayStatus && c.AutopayStatus !== 'Inactive');

      if (isActive && isAutopay) {
        console.log('mb-book: Client', clientId, 'has active autopay contract:', c.ContractName || c.Id);
        return { allowed: true, reason: 'contract', contractName: c.ContractName || '' };
      }
    }
  } catch (err) {
    console.warn('mb-book: Could not check contracts:', err.message);
    // Don't block booking if contract check fails — fall through to service check
  }

  // Check active services/passes
  try {
    var serviceData = await mbFetch('/client/clientservices?ClientId=' + clientId);
    var services = serviceData.ClientServices || [];
    var now2 = new Date();

    for (var j = 0; j < services.length; j++) {
      var s = services[j];
      var sActive = s.ActiveDate ? new Date(s.ActiveDate) <= now2 : true;
      var sNotExpired = s.ExpirationDate ? new Date(s.ExpirationDate) >= now2 : true;
      var hasRemaining = s.Remaining === undefined || s.Remaining === null || s.Remaining > 0;
      var isCurrent = s.Current !== false;

      if (sActive && sNotExpired && hasRemaining && isCurrent) {
        console.log('mb-book: Client', clientId, 'has active service:', s.Name || s.Id);
        return { allowed: true, reason: 'service', serviceName: s.Name || '' };
      }
    }
  } catch (err) {
    console.warn('mb-book: Could not check services:', err.message);
    // Don't block booking if service check fails — try booking anyway
    return { allowed: true, reason: 'fallback' };
  }

  // No active contract or service found
  return { allowed: false };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // POST: Book class
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');

      if (!body.clientId || !body.classId) {
        return jsonResponse(400, { error: 'clientId and classId are required' });
      }

      // Gate: check if client is eligible to book
      var eligibility = await checkBookingEligibility(body.clientId);

      if (!eligibility.allowed) {
        return jsonResponse(403, {
          error: 'no_pass',
          message: 'Client does not have an active membership or pass.'
        });
      }

      const data = await mbFetch('/class/addclienttoclass', {
        method: 'POST',
        body: JSON.stringify({
          ClientId: body.clientId,
          ClassId: body.classId,
          Test: body.test || false,
          SendEmail: true
        })
      });

      return jsonResponse(200, {
        success: true,
        visit: data.Visit || null,
        eligibility: eligibility.reason,
        message: 'Class booked successfully'
      });
    } catch (err) {
      console.error('mb-book POST error:', err.message, err.data ? JSON.stringify(err.data) : '');
      var errorMsg = err.message || 'Booking failed';
      if (err.data && err.data.Error && err.data.Error.Message) {
        errorMsg = err.data.Error.Message;
      }
      return jsonResponse(err.status || 500, { error: errorMsg });
    }
  }

  // DELETE: Cancel booking
  if (event.httpMethod === 'DELETE') {
    try {
      const body = JSON.parse(event.body || '{}');

      if (!body.clientId || !body.classId) {
        return jsonResponse(400, { error: 'clientId and classId are required' });
      }

      const data = await mbFetch('/class/removeclientfromclass', {
        method: 'POST',
        body: JSON.stringify({
          ClientId: body.clientId,
          ClassId: body.classId,
          LateCancel: body.lateCancel || false,
          SendEmail: true
        })
      });

      return jsonResponse(200, {
        success: true,
        message: 'Booking cancelled successfully'
      });
    } catch (err) {
      console.error('mb-book DELETE error:', err.message, err.data ? JSON.stringify(err.data) : '');
      var cancelMsg = err.message || 'Cancellation failed';
      if (err.data && err.data.Error && err.data.Error.Message) {
        cancelMsg = err.data.Error.Message;
      }
      return jsonResponse(err.status || 500, { error: cancelMsg });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};

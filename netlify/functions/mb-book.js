/**
 * Netlify Function: POST/DELETE /.netlify/functions/mb-book
 * Books or cancels a client from a Mindbody class.
 *
 * BOOKING STRATEGY:
 *   1. Check if client has an active autopay contract → book (bypasses billing cycle)
 *   2. Otherwise, try booking directly — Mindbody validates the pass/service
 *   3. If Mindbody rejects with payment error → return "no_pass" for frontend prompt
 *
 * POST body (book):
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *
 * DELETE body (cancel):
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *   lateCancel (boolean) - if true, marks as late cancel
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

/**
 * Check if client has an active autopay contract (recurring membership).
 * This is ONLY needed for the special case: booking past billing cycle.
 */
async function hasAutopayContract(clientId) {
  try {
    var contractData = await mbFetch('/client/clientcontracts?ClientId=' + clientId);
    var contracts = contractData.Contracts || [];
    var now = new Date();

    for (var i = 0; i < contracts.length; i++) {
      var c = contracts[i];
      var startDate = c.StartDate ? new Date(c.StartDate) : null;
      var endDate = c.EndDate ? new Date(c.EndDate) : null;
      var isActive = startDate && startDate <= now && (!endDate || endDate >= now);
      var isAutopay = c.IsAutoRenewing || (c.AutopayStatus && c.AutopayStatus !== 'Inactive');

      if (isActive && isAutopay) {
        console.log('mb-book: Client', clientId, 'has active autopay contract:', c.ContractName || c.Id);
        return true;
      }
    }
  } catch (err) {
    console.warn('mb-book: Could not check contracts:', err.message);
  }
  return false;
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

      // Try booking directly — staff token + Mindbody validates pass/service
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
        message: 'Class booked successfully'
      });
    } catch (err) {
      console.error('mb-book POST error:', err.message, err.data ? JSON.stringify(err.data) : '');
      var errorMsg = err.message || 'Booking failed';
      if (err.data && err.data.Error && err.data.Error.Message) {
        errorMsg = err.data.Error.Message;
      }

      // If already booked, treat as success
      var isAlreadyBooked = errorMsg.toLowerCase().indexOf('already') !== -1
        || errorMsg.toLowerCase().indexOf('enrolled') !== -1
        || errorMsg.toLowerCase().indexOf('signed up') !== -1;

      if (isAlreadyBooked) {
        return jsonResponse(200, {
          success: true,
          alreadyBooked: true,
          message: 'Client is already booked for this class'
        });
      }

      // If Mindbody rejects due to no valid pricing/pass, check for autopay contract
      var isPaymentError = errorMsg.toLowerCase().indexOf('payment') !== -1
        || errorMsg.toLowerCase().indexOf('pricing') !== -1
        || errorMsg.toLowerCase().indexOf('service') !== -1
        || errorMsg.toLowerCase().indexOf('pass') !== -1
        || err.status === 412;

      if (isPaymentError) {
        // Check if client has autopay membership — if so, they should be allowed
        var hasAutopay = await hasAutopayContract(body.clientId);
        if (hasAutopay) {
          // Retry — this time Mindbody should allow it via staff token
          // The staff user needs "Make Unpaid Reservation" permission in Mindbody
          console.log('mb-book: Autopay member — retrying booking');
          try {
            const retryData = await mbFetch('/class/addclienttoclass', {
              method: 'POST',
              body: JSON.stringify({
                ClientId: body.clientId,
                ClassId: body.classId,
                Test: body.test || false,
                SendEmail: true,
                RequirePayment: false
              })
            });
            return jsonResponse(200, {
              success: true,
              visit: retryData.Visit || null,
              message: 'Class booked (autopay member)'
            });
          } catch (retryErr) {
            console.error('mb-book retry error:', retryErr.message);
            var retryMsg = retryErr.message;
            if (retryErr.data && retryErr.data.Error && retryErr.data.Error.Message) {
              retryMsg = retryErr.data.Error.Message;
            }
            return jsonResponse(retryErr.status || 500, { error: retryMsg });
          }
        }

        // No autopay → client needs to buy a pass
        return jsonResponse(403, {
          error: 'no_pass',
          message: errorMsg
        });
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

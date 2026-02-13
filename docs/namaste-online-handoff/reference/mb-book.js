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
 * Validate that the client has a service/pass covering this class.
 * Staff token bypasses Mindbody's built-in payment validation, so we do it manually.
 *
 * Uses GET /sale/services?ClassId=X to ask Mindbody which pricing options (and
 * therefore which Programs/service categories) are valid for the class. This
 * respects Service Category Relationships configured in the business settings,
 * so cross-category passes work automatically.
 *
 * Returns { allowed: true } or { allowed: false, reason: '...' }
 */
async function validateClientPass(clientId, classId) {
  try {
    // 1. Fetch class info AND client services valid for THIS specific class in parallel.
    //    The ClassId filter on /client/clientservices tells Mindbody to return ONLY
    //    the client's passes that can pay for this class — including cross-category
    //    relationships configured in the business settings.
    var [classData, classFilteredServices, allClientServices] = await Promise.all([
      mbFetch('/class/classes?ClassIds=' + classId + '&Limit=1'),
      mbFetch('/client/clientservices?ClientId=' + clientId + '&ClassId=' + classId + '&Limit=200').catch(function() {
        return { ClientServices: [] };
      }),
      mbFetch('/client/clientservices?ClientId=' + clientId + '&Limit=200').catch(function() {
        return { ClientServices: [] };
      })
    ]);

    var classes = classData.Classes || [];
    var cls = classes[0] || {};
    var classProgramId = cls.ClassDescription && cls.ClassDescription.Program
      ? cls.ClassDescription.Program.Id : null;
    var classProgramName = (cls.ClassDescription && cls.ClassDescription.Program)
      ? cls.ClassDescription.Program.Name : 'this class type';

    // 2. Check class-filtered services — these are the client's passes Mindbody
    //    says are valid for this specific class (respects cross-category relationships)
    var validForClass = classFilteredServices.ClientServices || [];
    var now = new Date();

    console.log('mb-book: Class', classId, 'program:', classProgramId, '(' + classProgramName + ')');
    console.log('mb-book: Client services valid for this class (ClassId filter):', validForClass.length);

    for (var i = 0; i < validForClass.length; i++) {
      var s = validForClass[i];
      var sActive = s.ActiveDate ? new Date(s.ActiveDate) : null;
      var sExpiry = s.ExpirationDate ? new Date(s.ExpirationDate) : null;
      var isCurrent = s.Current || (sActive && sActive <= now && (!sExpiry || sExpiry >= now));

      console.log('  -', s.Name, '| program:', s.Program ? s.Program.Id + ' (' + s.Program.Name + ')' : 'none',
        '| current:', isCurrent, '| remaining:', s.Remaining);

      if (isCurrent) {
        if (s.Remaining != null && s.Remaining <= 0) {
          continue; // Used up, check others
        }
        console.log('mb-book: ALLOWED — client has valid service:', s.Name,
          'program:', s.Program ? s.Program.Id : '?', '(class program:', classProgramId, ')');
        return { allowed: true, classProgramId: classProgramId };
      }
    }

    // 3. Fallback: check all client services by program ID match (same-category)
    //    in case the ClassId filter didn't work as expected
    var allServices = allClientServices.ClientServices || [];
    console.log('mb-book: Fallback — checking all', allServices.length, 'client services by program match');

    for (var j = 0; j < allServices.length; j++) {
      var sv = allServices[j];
      var svActive = sv.ActiveDate ? new Date(sv.ActiveDate) : null;
      var svExpiry = sv.ExpirationDate ? new Date(sv.ExpirationDate) : null;
      var svCurrent = sv.Current || (svActive && svActive <= now && (!svExpiry || svExpiry >= now));

      if (svCurrent && sv.Program && Number(sv.Program.Id) === Number(classProgramId)) {
        if (sv.Remaining != null && sv.Remaining <= 0) continue;
        console.log('mb-book: ALLOWED (fallback) — exact program match:', sv.Name, 'program:', sv.Program.Id);
        return { allowed: true, classProgramId: classProgramId };
      }
    }

    console.log('mb-book: DENIED — no valid pass for class', classId, 'program', classProgramId, '(' + classProgramName + ')');
    return { allowed: false, reason: 'No valid pass for ' + classProgramName, classProgramId: classProgramId, classProgramName: classProgramName };
  } catch (err) {
    console.error('mb-book: Pass validation error:', err.message, '— BLOCKING booking (fail closed)');
    return { allowed: false, reason: 'Could not validate pass — please try again' };
  }
}

/**
 * Check if client has an active autopay contract.
 * This is ONLY needed for the special case: booking past billing cycle where
 * the service expired between cycles but the membership is still active.
 */
async function hasAutopayContract(clientId) {
  try {
    var contractsData = await mbFetch('/client/clientcontracts?ClientId=' + clientId);
    var contracts = contractsData.Contracts || [];
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
    return false;
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

      // Server-side pass validation: staff token bypasses Mindbody's own check,
      // so we must verify the client has a service covering this class's program.
      var passCheck = await validateClientPass(body.clientId, body.classId);
      if (!passCheck.allowed) {
        return jsonResponse(403, {
          error: 'no_pass',
          message: passCheck.reason || 'Client does not have a valid pass for this class',
          programName: passCheck.classProgramName || null,
          programId: passCheck.classProgramId || null
        });
      }

      // Try booking — pass is validated
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
        // Check if client has autopay membership for a valid program — if so, likely a billing gap
        var hasAutopay = await hasAutopayContract(body.clientId);
        if (hasAutopay) {
          // Retry — this time Mindbody should allow it via staff token
          // The staff user needs "Make Unpaid Reservation" permission in Mindbody
          console.log('mb-book: Autopay member with matching program — retrying booking');
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
        lateCancel: body.lateCancel || false,
        message: body.lateCancel ? 'Late cancellation processed' : 'Booking cancelled successfully'
      });
    } catch (err) {
      console.error('mb-book DELETE error:', err.message, err.data ? JSON.stringify(err.data) : '');
      var cancelMsg = err.message || 'Cancellation failed';
      if (err.data && err.data.Error && err.data.Error.Message) {
        cancelMsg = err.data.Error.Message;
      }

      // Detect cancellation window error — retry with LateCancel: true
      var isWindowError = cancelMsg.toLowerCase().indexOf('cancel') !== -1
        && (cancelMsg.toLowerCase().indexOf('window') !== -1
          || cancelMsg.toLowerCase().indexOf('late') !== -1
          || cancelMsg.toLowerCase().indexOf('deadline') !== -1
          || cancelMsg.toLowerCase().indexOf('period') !== -1);

      if (isWindowError && !body.lateCancel) {
        console.log('mb-book: Outside cancellation window — retrying as late cancel');
        try {
          await mbFetch('/class/removeclientfromclass', {
            method: 'POST',
            body: JSON.stringify({
              ClientId: body.clientId,
              ClassId: body.classId,
              LateCancel: true,
              SendEmail: true
            })
          });
          return jsonResponse(200, {
            success: true,
            lateCancel: true,
            message: 'Late cancellation processed — may incur fees'
          });
        } catch (retryErr) {
          console.error('mb-book late cancel retry error:', retryErr.message);
          var retryMsg = retryErr.message;
          if (retryErr.data && retryErr.data.Error && retryErr.data.Error.Message) {
            retryMsg = retryErr.data.Error.Message;
          }
          return jsonResponse(retryErr.status || 500, { error: retryMsg });
        }
      }

      return jsonResponse(err.status || 500, { error: cancelMsg });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};

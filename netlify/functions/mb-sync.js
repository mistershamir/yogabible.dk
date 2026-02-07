/**
 * Netlify Function: POST /.netlify/functions/mb-sync
 * Syncs a Firebase user with their Mindbody client profile.
 * Called after login to check membership status.
 *
 * Body:
 *   email (string) - user's email
 *   firebaseUid (string) - Firebase user ID (for reference)
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    var body = JSON.parse(event.body || '{}');

    if (!body.email) {
      return jsonResponse(400, { error: 'email is required' });
    }

    // 1. Look up client in Mindbody by email
    var queryString = new URLSearchParams({
      searchText: body.email,
      limit: '10'
    }).toString();

    var clientData = await mbFetch(`/client/clients?${queryString}`);

    var clients = (clientData.Clients || []).filter(function(c) {
      return c.Email && c.Email.toLowerCase() === body.email.toLowerCase();
    });

    if (clients.length === 0) {
      return jsonResponse(200, {
        found: false,
        mindbodyClientId: null,
        membershipTier: 'free',
        activeMemberships: []
      });
    }

    var client = clients[0];

    // 2. Check active memberships/contracts
    var membershipTier = 'free';
    var activeMemberships = [];

    try {
      var contractData = await mbFetch(
        `/client/clientcontracts?clientId=${client.Id}&limit=50`
      );

      var contracts = contractData.Contracts || [];
      var now = new Date();

      activeMemberships = contracts.filter(function(c) {
        var endDate = c.EndDate ? new Date(c.EndDate) : null;
        return c.Agreement && c.Agreement.AutopayStatus === 'Active' ||
               (endDate && endDate > now);
      }).map(function(c) {
        return {
          name: c.Agreement ? c.Agreement.Name : 'Membership',
          startDate: c.StartDate,
          endDate: c.EndDate,
          autopayStatus: c.Agreement ? c.Agreement.AutopayStatus : null
        };
      });

      if (activeMemberships.length > 0) {
        membershipTier = 'member';
      }
    } catch (contractErr) {
      // Some API plans may not have access to contracts endpoint
      console.warn('Could not fetch contracts:', contractErr.message);
    }

    // 3. Also check active services/visits
    try {
      var serviceData = await mbFetch(
        `/client/clientservices?clientId=${client.Id}&limit=50`
      );

      var activeServices = (serviceData.ClientServices || []).filter(function(s) {
        var expDate = s.ExpirationDate ? new Date(s.ExpirationDate) : null;
        return s.Active && (!expDate || expDate > new Date());
      });

      if (activeServices.length > 0 && membershipTier === 'free') {
        membershipTier = 'member';
      }
    } catch (serviceErr) {
      console.warn('Could not fetch client services:', serviceErr.message);
    }

    return jsonResponse(200, {
      found: true,
      mindbodyClientId: client.Id,
      membershipTier: membershipTier,
      activeMemberships: activeMemberships,
      clientName: (client.FirstName || '') + ' ' + (client.LastName || ''),
      clientStatus: client.Status,
      active: client.Active
    });
  } catch (err) {
    console.error('mb-sync error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

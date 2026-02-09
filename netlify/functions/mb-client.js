/**
 * Netlify Function: /.netlify/functions/mb-client
 *
 * GET  ?email=...   — Find Mindbody client by email
 * POST              — Create new Mindbody client
 *
 * Body for POST:
 *   firstName, lastName, email, phone (optional)
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // GET: Find client by email
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      if (!params.email) {
        return jsonResponse(400, { error: 'email parameter is required' });
      }

      const queryString = new URLSearchParams({
        searchText: params.email,
        limit: '10'
      }).toString();

      const data = await mbFetch(`/client/clients?${queryString}`);

      // Filter to exact email match
      var clients = (data.Clients || []).filter(function(c) {
        return c.Email && c.Email.toLowerCase() === params.email.toLowerCase();
      });

      if (clients.length > 0) {
        var client = clients[0];
        return jsonResponse(200, {
          found: true,
          client: {
            id: client.Id,
            firstName: client.FirstName,
            lastName: client.LastName,
            email: client.Email,
            phone: client.MobilePhone || client.HomePhone || '',
            birthDate: client.BirthDate || null,
            status: client.Status,
            active: client.Active,
            membershipName: client.MembershipIcon ? client.MembershipIcon.Name : null,
            liability: client.Liability ? {
              isReleased: client.Liability.IsReleased || false,
              agreementDate: client.Liability.AgreementDate || null,
              releasedBy: client.Liability.ReleasedBy
            } : { isReleased: false, agreementDate: null, releasedBy: null }
          }
        });
      }

      return jsonResponse(200, { found: false, client: null });
    } catch (err) {
      console.error('mb-client GET error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  // POST: Create new client
  if (event.httpMethod === 'POST') {
    try {
      var body = JSON.parse(event.body || '{}');

      if (!body.firstName || !body.lastName || !body.email) {
        return jsonResponse(400, { error: 'firstName, lastName, and email are required' });
      }

      var newClient = {
        FirstName: body.firstName,
        LastName: body.lastName,
        Email: body.email,
        SendAccountEmails: true
      };

      if (body.phone) {
        newClient.MobilePhone = body.phone;
      }
      if (body.birthDate) {
        newClient.BirthDate = body.birthDate;
      }

      var data = await mbFetch('/client/addclient', {
        method: 'POST',
        body: JSON.stringify(newClient)
      });

      var created = data.Client || {};
      return jsonResponse(201, {
        success: true,
        client: {
          id: created.Id,
          firstName: created.FirstName,
          lastName: created.LastName,
          email: created.Email
        }
      });
    } catch (err) {
      // Mindbody returns 400 for duplicate clients
      if (err.status === 400 && err.data) {
        return jsonResponse(409, {
          error: 'Client with this email may already exist',
          details: err.data.Message || err.message
        });
      }
      console.error('mb-client POST error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  // PUT: Update existing client
  if (event.httpMethod === 'PUT') {
    try {
      var body = JSON.parse(event.body || '{}');

      if (!body.clientId) {
        return jsonResponse(400, { error: 'clientId is required' });
      }

      var updateData = { ClientId: body.clientId };
      if (body.firstName) updateData.FirstName = body.firstName;
      if (body.lastName) updateData.LastName = body.lastName;
      if (body.email) updateData.Email = body.email;
      if (body.phone) updateData.MobilePhone = body.phone;
      if (body.birthDate) updateData.BirthDate = body.birthDate;

      var data = await mbFetch('/client/updateclient', {
        method: 'POST',
        body: JSON.stringify({ Client: updateData, CrossRegionalUpdate: true })
      });

      var updated = data.Client || {};
      return jsonResponse(200, {
        success: true,
        client: {
          id: updated.Id,
          firstName: updated.FirstName,
          lastName: updated.LastName,
          email: updated.Email,
          phone: updated.MobilePhone || '',
          birthDate: updated.BirthDate || null
        }
      });
    } catch (err) {
      console.error('mb-client PUT error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};

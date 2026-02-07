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
            status: client.Status,
            active: client.Active,
            membershipName: client.MembershipIcon ? client.MembershipIcon.Name : null
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

  return jsonResponse(405, { error: 'Method not allowed' });
};

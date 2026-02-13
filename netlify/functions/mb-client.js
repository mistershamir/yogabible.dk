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

  // GET: Find client by email, or fetch stored credit card by clientId
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      // GET ?action=storedCard&clientId=... — fetch stored credit card
      if (params.action === 'storedCard' && params.clientId) {
        // V6 API returns ClientCreditCard as part of the full Client object
        // No Fields param needed (doesn't exist in V6); use request.clientIDs
        const data = await mbFetch(`/client/clients?request.clientIDs=${params.clientId}`);
        console.log('[mb-client] storedCard response for', params.clientId, ':', JSON.stringify((data.Clients || []).map(c => ({ Id: c.Id, CC: c.ClientCreditCard }))));
        var clients = data.Clients || [];
        if (clients.length > 0 && clients[0].ClientCreditCard) {
          var cc = clients[0].ClientCreditCard;
          // Only consider it "stored" if we actually have a LastFour
          if (cc.LastFour) {
            return jsonResponse(200, {
              hasStoredCard: true,
              storedCard: {
                lastFour: cc.LastFour,
                cardType: cc.CardType || '',
                cardHolder: cc.CardHolder || '',
                expMonth: cc.ExpMonth || '',
                expYear: cc.ExpYear || ''
              }
            });
          }
        }
        return jsonResponse(200, { hasStoredCard: false, storedCard: null });
      }

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

  // POST: Create new client OR update stored card
  if (event.httpMethod === 'POST') {
    try {
      var body = JSON.parse(event.body || '{}');

      // Action: updateCard — save/replace stored credit card on client
      if (body.action === 'updateCard' && body.clientId && body.card) {
        var cardData = {
          CreditCardNumber: String(body.card.cardNumber),
          ExpMonth: String(body.card.expMonth),
          ExpYear: String(body.card.expYear),
          BillingName: String(body.card.cardHolder || '')
        };
        console.log('[mb-client] updateCard for client:', body.clientId);
        var updateResult = await mbFetch('/client/updateclient', {
          method: 'POST',
          body: JSON.stringify({ Client: { Id: body.clientId, ClientCreditCard: cardData } })
        });
        var updatedClient = updateResult.Client || {};
        var updatedCC = updatedClient.ClientCreditCard || {};
        return jsonResponse(200, {
          success: true,
          cardType: updatedCC.CardType || '',
          lastFour: updatedCC.LastFour || body.card.cardNumber.slice(-4)
        });
      }

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

      // MB updateclient uses "Id" (numeric), NOT "ClientId" (which is the Custom ID field)
      var updateData = { Id: body.clientId };
      if (body.firstName) updateData.FirstName = body.firstName;
      if (body.lastName) updateData.LastName = body.lastName;
      if (body.email) updateData.Email = body.email;
      if (body.phone) updateData.MobilePhone = body.phone;
      if (body.birthDate) {
        // MB API expects full ISO datetime for BirthDate
        var bd = body.birthDate;
        if (bd.length === 10) bd = bd + 'T00:00:00';
        updateData.BirthDate = bd;
      }

      console.log('[mb-client] PUT updateData:', JSON.stringify(updateData));

      var data = await mbFetch('/client/updateclient', {
        method: 'POST',
        body: JSON.stringify({ Client: updateData })
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
      console.error('mb-client PUT error:', err.message, err.data ? JSON.stringify(err.data) : '');
      var errMsg = err.message || 'Update failed';
      if (err.data && err.data.Error && err.data.Error.Message) errMsg = err.data.Error.Message;
      return jsonResponse(err.status || 500, { error: errMsg, _debug: err.data || null });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};

/**
 * Netlify Function: GET /.netlify/functions/mb-client-services
 * Fetches client's active services/passes and contracts from Mindbody.
 *
 * Query params:
 *   clientId (required) - Mindbody client ID
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

    // Fetch both client services and contracts in parallel
    var [servicesData, contractsData] = await Promise.all([
      mbFetch('/client/clientservices?ClientId=' + params.clientId + '&Limit=200').catch(function(e) {
        console.warn('mb-client-services: services fetch failed:', e.message);
        return { ClientServices: [] };
      }),
      mbFetch('/client/clientcontracts?ClientId=' + params.clientId).catch(function(e) {
        console.warn('mb-client-services: contracts fetch failed:', e.message);
        return { Contracts: [] };
      })
    ]);

    var now = new Date();

    // Map client services (passes, class packs)
    var services = (servicesData.ClientServices || []).map(function(s) {
      var activeDate = s.ActiveDate ? new Date(s.ActiveDate) : null;
      var expirationDate = s.ExpirationDate ? new Date(s.ExpirationDate) : null;
      var isCurrent = s.Current || (activeDate && activeDate <= now && (!expirationDate || expirationDate >= now));

      return {
        id: s.Id,
        name: s.Name || '',
        remaining: s.Remaining != null ? s.Remaining : null,
        count: s.Count || null,
        activeDate: s.ActiveDate,
        expirationDate: s.ExpirationDate,
        current: isCurrent,
        paymentDate: s.PaymentDate || null,
        programId: s.Program ? s.Program.Id : null,
        programName: s.Program ? s.Program.Name : ''
      };
    });

    // Map contracts (memberships, autopay)
    var contracts = (contractsData.Contracts || []).map(function(c) {
      var startDate = c.StartDate ? new Date(c.StartDate) : null;
      var endDate = c.EndDate ? new Date(c.EndDate) : null;
      var isActive = startDate && startDate <= now && (!endDate || endDate >= now);
      var isAutopay = c.IsAutoRenewing || (c.AutopayStatus && c.AutopayStatus !== 'Inactive');

      return {
        id: c.Id,
        name: c.ContractName || '',
        startDate: c.StartDate,
        endDate: c.EndDate,
        isActive: isActive,
        isAutopay: isAutopay,
        autopayStatus: c.AutopayStatus || ''
      };
    });

    // Summarize for easy consumption
    var activeServices = services.filter(function(s) { return s.current; });
    var activeContracts = contracts.filter(function(c) { return c.isActive; });
    var hasActivePass = activeServices.length > 0 || activeContracts.length > 0;

    return jsonResponse(200, {
      services: services,
      contracts: contracts,
      activeServices: activeServices,
      activeContracts: activeContracts,
      hasActivePass: hasActivePass
    });
  } catch (err) {
    console.error('mb-client-services error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

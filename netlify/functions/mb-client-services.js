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

    // Fetch client services, contracts, and pause notes in parallel.
    // Pause notes are needed because MB's IsSuspended is false for future-dated pauses.
    var [servicesData, contractsData, pauseNotes] = await Promise.all([
      mbFetch('/client/clientservices?ClientId=' + params.clientId + '&Limit=200').catch(function(e) {
        console.warn('mb-client-services: services fetch failed:', e.message);
        return { ClientServices: [] };
      }),
      mbFetch('/client/clientcontracts?ClientId=' + params.clientId).catch(function(e) {
        console.warn('mb-client-services: contracts fetch failed:', e.message);
        return { Contracts: [] };
      }),
      // Read pause marker notes (CONTRACT_PAUSED|contractId|startDate|endDate)
      mbFetch('/client/clientnotes?ClientId=' + params.clientId + '&Limit=100').then(function(notesData) {
        var notes = notesData.Notes || notesData.ClientNotes || [];
        var pauses = {};
        for (var i = 0; i < notes.length; i++) {
          var text = notes[i].Text || notes[i].Note || notes[i].Body || '';
          if (text.indexOf('CONTRACT_PAUSED') === 0) {
            var parts = text.split('|');
            if (parts.length >= 4) {
              var cId = Number(parts[1]);
              var endD = new Date(parts[3]);
              // Only use notes where the pause end date is still in the future
              if (endD >= now) {
                pauses[cId] = { startDate: parts[2], endDate: parts[3] };
              }
            }
          }
        }
        return pauses;
      }).catch(function(e) {
        console.warn('mb-client-services: notes fetch failed:', e.message);
        return {};
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

      // Calculate next billing date from UpcomingAutopayEvents or autopay schedule
      var nextBillingDate = null;
      if (c.UpcomingAutopayEvents && c.UpcomingAutopayEvents.length > 0) {
        // Sort by date, pick the next one
        var sorted = c.UpcomingAutopayEvents.sort(function(a, b) {
          return new Date(a.ChargeDate || a.ScheduleDate) - new Date(b.ChargeDate || b.ScheduleDate);
        });
        var next = sorted.find(function(e) {
          var d = new Date(e.ChargeDate || e.ScheduleDate);
          return d >= now;
        });
        if (next) nextBillingDate = next.ChargeDate || next.ScheduleDate;
      }

      // Log ALL raw contract fields to discover suspension-related data.
      // MB API may use field names we haven't tried yet.
      var suspectFields = {};
      Object.keys(c).forEach(function(k) {
        var kl = k.toLowerCase();
        if (kl.indexOf('suspend') > -1 || kl.indexOf('pause') > -1 ||
            kl.indexOf('resume') > -1 || kl.indexOf('freeze') > -1 ||
            kl.indexOf('hold') > -1) {
          suspectFields[k] = c[k];
        }
      });
      console.log('[mb-client-services] Contract', c.Id, c.ContractName,
        'IsSuspended:', c.IsSuspended,
        'suspectFields:', JSON.stringify(suspectFields),
        'allKeys:', Object.keys(c).join(',')
      );

      // Pause detection: check MB fields first, then fall back to our pause notes.
      // IsSuspended = true only for currently active pauses (not future-dated).
      // For future-dated pauses, we rely on our CONTRACT_PAUSED notes.
      var pauseStartDate = c.SuspensionStart || c.SuspendDate || c.SuspensionDate || null;
      var pauseEndDate = c.ResumeDate || c.ResumptionDate || null;
      var isPaused = c.IsSuspended || !!(pauseStartDate && pauseEndDate);

      // Check our pause notes for future-dated pauses MB doesn't flag
      if (!isPaused && pauseNotes[c.Id]) {
        pauseStartDate = pauseNotes[c.Id].startDate;
        pauseEndDate = pauseNotes[c.Id].endDate;
        isPaused = true;
        console.log('[mb-client-services] Contract', c.Id, 'detected as paused via note:', pauseStartDate, '→', pauseEndDate);
      }

      return {
        id: c.Id,
        contractId: c.ContractId || null,
        locationId: c.LocationId || null,
        name: c.ContractName || '',
        startDate: c.StartDate,
        endDate: c.EndDate,
        isActive: isActive,
        isAutopay: isAutopay,
        autopayStatus: c.AutopayStatus || '',
        agreementDate: c.AgreementDate || null,
        nextBillingDate: nextBillingDate,
        autopayAmount: c.AutopayAmount || 0,
        isSuspended: isPaused,
        pauseStartDate: pauseStartDate,
        pauseEndDate: pauseEndDate,
        terminationDate: c.TerminationDate || null
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

/**
 * Netlify Function: GET /.netlify/functions/mb-site
 * Fetches site configuration data from Mindbody:
 * session types, programs, locations, memberships, promo codes.
 *
 * Query params:
 *   type - 'sessionTypes' (default), 'programs', 'locations', 'memberships', 'promoCodes'
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
    var type = params.type || 'sessionTypes';

    // ─── Session Types ───
    if (type === 'sessionTypes') {
      var data = await mbFetch('/site/sessiontypes?Limit=200');
      var sessionTypes = (data.SessionTypes || []).map(function(st) {
        return {
          id: st.Id,
          name: st.Name || '',
          numDeducted: st.NumDeducted || 0,
          programId: st.ProgramId || null,
          category: st.Type || '',
          defaultTimeLength: st.DefaultTimeLength || null,
          staffTimeLength: st.StaffTimeLength || null
        };
      });
      return jsonResponse(200, { sessionTypes: sessionTypes, total: sessionTypes.length });
    }

    // ─── Programs ───
    if (type === 'programs') {
      var data = await mbFetch('/site/programs?Limit=200');
      var programs = (data.Programs || []).map(function(p) {
        return {
          id: p.Id,
          name: p.Name || '',
          scheduleType: p.ScheduleType || '',
          cancelOffset: p.CancelOffset || null,
          contentFormats: p.ContentFormats || []
        };
      });
      return jsonResponse(200, { programs: programs, total: programs.length });
    }

    // ─── Locations ───
    if (type === 'locations') {
      var data = await mbFetch('/site/locations');
      var locations = (data.Locations || []).map(function(l) {
        return {
          id: l.Id,
          name: l.Name || '',
          address: l.Address || '',
          address2: l.Address2 || '',
          city: l.City || '',
          postalCode: l.PostalCode || '',
          state: l.StateProvCode || '',
          phone: l.Phone || '',
          latitude: l.Latitude || null,
          longitude: l.Longitude || null,
          tax1: l.Tax1 || 0,
          tax2: l.Tax2 || 0
        };
      });
      return jsonResponse(200, { locations: locations, total: locations.length });
    }

    // ─── Memberships ───
    if (type === 'memberships') {
      var data = await mbFetch('/site/memberships?Limit=200');
      var memberships = (data.Memberships || []).map(function(m) {
        return {
          id: m.Id,
          name: m.Name || '',
          count: m.Count || 0,
          membershipType: m.MembershipType || '',
          priority: m.Priority || null
        };
      });
      return jsonResponse(200, { memberships: memberships, total: memberships.length });
    }

    // ─── Promo Codes ───
    if (type === 'promoCodes') {
      var data = await mbFetch('/site/promocodes?Limit=200');
      var codes = (data.PromoCodes || []).map(function(pc) {
        return {
          id: pc.Id,
          code: pc.Code || '',
          name: pc.Name || '',
          discountType: pc.DiscountType || '',
          discountAmount: pc.DiscountAmount || 0,
          discountPercent: pc.DiscountPercent || 0,
          active: pc.Active !== false,
          startDate: pc.StartDate || null,
          endDate: pc.EndDate || null
        };
      });
      return jsonResponse(200, { promoCodes: codes, total: codes.length });
    }

    return jsonResponse(400, { error: 'Invalid type. Use: sessionTypes, programs, locations, memberships, promoCodes' });
  } catch (err) {
    console.error('mb-site error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

/**
 * Netlify Function: GET /.netlify/functions/mb-services
 * Fetches purchasable services/products from Mindbody.
 *
 * Query params:
 *   type - 'services' (default) or 'products'
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
    var type = params.type || 'services';

    // Return service categories
    if (type === 'categories') {
      var catData = await mbFetch('/sale/servicecategories');
      var categories = (catData.ServiceCategories || []).map(function(c) {
        return {
          id: c.Id,
          name: c.Name
        };
      });
      return jsonResponse(200, { categories, total: categories.length });
    }

    if (type === 'products') {
      var prodData = await mbFetch('/sale/products?limit=200');
      var products = (prodData.Products || []).map(function(p) {
        return {
          id: p.Id,
          name: p.Name,
          price: p.Price,
          onlinePrice: p.OnlinePrice,
          description: p.ShortDescription || p.LongDescription || '',
          categoryId: p.CategoryId,
          subCategoryId: p.SubCategoryId
        };
      });
      return jsonResponse(200, { products, total: products.length });
    }

    // Default: services (pricing options, packages, etc.)
    var svcPath = '/sale/services?limit=200';
    if (params.sellOnline === 'true') svcPath += '&SellOnline=true';
    if (params.serviceCategoryIds) svcPath += '&ServiceCategoryIds=' + params.serviceCategoryIds;
    if (params.programIds) svcPath += '&ProgramIds=' + params.programIds;

    var svcData = await mbFetch(svcPath);
    var services = (svcData.Services || []).map(function(s) {
      return {
        id: s.Id,
        name: s.Name,
        price: s.Price,
        onlinePrice: s.OnlinePrice,
        count: s.Count,
        programId: s.Program ? s.Program.Id : null,
        programName: s.Program ? s.Program.Name : null
      };
    });

    return jsonResponse(200, { services, total: services.length });
  } catch (err) {
    console.error('mb-services error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};

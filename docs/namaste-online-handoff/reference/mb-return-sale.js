/**
 * Netlify Function: POST /.netlify/functions/mb-return-sale
 * Processes a sale return/refund through Mindbody.
 *
 * POST body:
 *   saleId (number) - the sale ID to return
 *   test (boolean, optional) - if true, validates without processing
 *
 * IMPORTANT: This is an admin-level operation. The staff token must have
 * return/refund permissions in Mindbody. In production, add auth checks
 * to restrict who can trigger refunds.
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

    if (!body.saleId) {
      return jsonResponse(400, { error: 'saleId is required' });
    }

    console.log('mb-return-sale: Processing return for sale', body.saleId);

    var data = await mbFetch('/sale/returnsale', {
      method: 'POST',
      body: JSON.stringify({
        Id: body.saleId,
        Test: body.test || false
      })
    });

    return jsonResponse(200, {
      success: true,
      sale: data.Sale || null,
      message: 'Sale returned/refunded successfully'
    });
  } catch (err) {
    console.error('mb-return-sale error:', err.message, err.data ? JSON.stringify(err.data) : '');
    var errorMsg = err.message || 'Return/refund failed';
    if (err.data && err.data.Error && err.data.Error.Message) {
      errorMsg = err.data.Error.Message;
    }
    return jsonResponse(err.status || 500, { error: errorMsg });
  }
};

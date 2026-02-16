/**
 * Google Sheets API Helper — Yoga Bible
 * Replaces SpreadsheetApp from Apps Script
 * Uses a Google Service Account for authentication.
 */

const { sheets } = require('@googleapis/sheets');
const { GoogleAuth } = require('google-auth-library');
const { CONFIG } = require('./config');

let authClient = null;
let sheetsApi = null;

/**
 * Get authenticated Google API client using service account credentials.
 * Uses individual env vars to stay under the 4KB Lambda env limit.
 */
function getAuth() {
  if (authClient) return authClient;

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error('Google credentials not set. Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY to Netlify environment variables.');
  }

  authClient = new GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, '\n')
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });
  return authClient;
}

/**
 * Get authenticated Google Sheets API instance.
 */
function getSheetsApi() {
  if (sheetsApi) return sheetsApi;
  const auth = getAuth();
  sheetsApi = sheets({ version: 'v4', auth });
  return sheetsApi;
}

/**
 * Read all data from a sheet.
 * @param {string} sheetName - Name of the sheet tab
 * @param {string} [spreadsheetId] - Override spreadsheet ID
 * @returns {Promise<string[][]>} - 2D array of cell values
 */
async function getSheetData(sheetName, spreadsheetId) {
  const sheets = getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId || CONFIG.SPREADSHEET_ID,
    range: sheetName
  });
  return res.data.values || [];
}

/**
 * Append a row to a sheet.
 * @param {string} sheetName - Name of the sheet tab
 * @param {any[]} rowData - Array of cell values
 * @param {string} [spreadsheetId] - Override spreadsheet ID
 */
async function appendRow(sheetName, rowData, spreadsheetId) {
  const sheets = getSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId || CONFIG.SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowData]
    }
  });
}

/**
 * Update a specific cell.
 * @param {string} sheetName - Name of the sheet tab
 * @param {number} row - 1-based row number
 * @param {number} col - 1-based column number
 * @param {any} value - Cell value
 * @param {string} [spreadsheetId] - Override spreadsheet ID
 */
async function updateCell(sheetName, row, col, value, spreadsheetId) {
  const sheets = getSheetsApi();
  const colLetter = columnToLetter(col);
  const range = `${sheetName}!${colLetter}${row}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId || CONFIG.SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[value]]
    }
  });
}

/**
 * Update multiple cells in a row.
 * @param {string} sheetName - Name of the sheet tab
 * @param {number} row - 1-based row number
 * @param {Object<number, any>} updates - Map of 1-based column number to value
 * @param {string} [spreadsheetId] - Override spreadsheet ID
 */
async function updateRowCells(sheetName, row, updates, spreadsheetId) {
  const sheets = getSheetsApi();
  const data = Object.entries(updates).map(([col, value]) => ({
    range: `${sheetName}!${columnToLetter(Number(col))}${row}`,
    values: [[value]]
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId || CONFIG.SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data
    }
  });
}

/**
 * Get headers (first row) of a sheet.
 * @param {string} sheetName
 * @param {string} [spreadsheetId]
 * @returns {Promise<string[]>}
 */
async function getHeaders(sheetName, spreadsheetId) {
  const sheets = getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId || CONFIG.SPREADSHEET_ID,
    range: `${sheetName}!1:1`
  });
  return (res.data.values && res.data.values[0]) || [];
}

/**
 * Convert 1-based column number to letter (1=A, 2=B, 27=AA, etc.)
 */
function columnToLetter(col) {
  let letter = '';
  let temp = col;
  while (temp > 0) {
    temp--;
    letter = String.fromCharCode(65 + (temp % 26)) + letter;
    temp = Math.floor(temp / 26);
  }
  return letter;
}

/**
 * Parse sheet data into array of objects using headers.
 * @param {string[][]} data - 2D array from getSheetData (first row = headers)
 * @returns {{ headers: string[], rows: Object[], raw: string[][] }}
 */
function parseSheetData(data) {
  if (!data || data.length === 0) return { headers: [], rows: [], raw: data };
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (data[i] && data[i][j]) || '';
    }
    row._rowIndex = i + 1; // 1-based sheet row number
    rows.push(row);
  }
  return { headers, rows, raw: data };
}

module.exports = {
  getAuth,
  getSheetsApi,
  getSheetData,
  appendRow,
  updateCell,
  updateRowCells,
  getHeaders,
  columnToLetter,
  parseSheetData
};

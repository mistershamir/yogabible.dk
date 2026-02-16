/**
 * Google Sheets API Helper — Yoga Bible
 * DEPRECATED: Being replaced by Firestore. These stubs prevent import errors
 * in functions that haven't been migrated yet. The actual Sheets API packages
 * have been removed to stay under the 4KB Lambda env var limit.
 */

const { CONFIG } = require('./config');

function notAvailable(name) {
  return function () {
    throw new Error(`${name}() is no longer available. Google Sheets has been removed — use Firestore instead.`);
  };
}

/**
 * Convert 1-based column number to letter (1=A, 2=B, 27=AA, etc.)
 * Kept because it's a pure utility with no Google dependency.
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
 * Kept because it's a pure utility with no Google dependency.
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
    row._rowIndex = i + 1;
    rows.push(row);
  }
  return { headers, rows, raw: data };
}

module.exports = {
  getAuth: notAvailable('getAuth'),
  getSheetsApi: notAvailable('getSheetsApi'),
  getSheetData: notAvailable('getSheetData'),
  appendRow: notAvailable('appendRow'),
  updateCell: notAvailable('updateCell'),
  updateRowCells: notAvailable('updateRowCells'),
  getHeaders: notAvailable('getHeaders'),
  columnToLetter,
  parseSheetData
};

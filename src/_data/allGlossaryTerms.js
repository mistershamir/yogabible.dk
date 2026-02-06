const fs = require('fs');
const path = require('path');

module.exports = function () {
  const dataDir = path.join(__dirname, 'glossary');
  const files = fs.readdirSync(dataDir).filter(function (f) {
    return f.endsWith('.json') && f !== 'categories.json';
  });

  var terms = [];
  files.forEach(function (file) {
    var data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    terms = terms.concat(data);
  });

  return terms.sort(function (a, b) {
    return a.sanskrit.localeCompare(b.sanskrit);
  });
};

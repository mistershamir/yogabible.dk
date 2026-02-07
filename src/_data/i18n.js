var fs = require('fs');
var path = require('path');

module.exports = function() {
  var dir = path.join(__dirname, 'i18n');
  var files = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  var data = {};
  files.forEach(function(f) {
    var key = f.replace('.json', '');
    data[key] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  });
  return data;
};

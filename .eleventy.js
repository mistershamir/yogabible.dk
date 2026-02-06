var markdownIt = require('markdown-it');
var md = markdownIt({ html: true, breaks: true, linkify: true });

module.exports = function(eleventyConfig) {
  // Pass through static assets
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/admin");

  // Pass through root files (favicons, etc.)
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "src/favicon-16x16.png": "favicon-16x16.png" });
  eleventyConfig.addPassthroughCopy({ "src/favicon-32x32.png": "favicon-32x32.png" });
  eleventyConfig.addPassthroughCopy({ "src/apple-touch-icon.png": "apple-touch-icon.png" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });

  // Date filter for sitemap
  eleventyConfig.addFilter("date", function(dateObj, format) {
    if (format === "%Y-%m-%d") {
      var d = new Date(dateObj);
      return d.toISOString().split("T")[0];
    }
    return dateObj;
  });

  // Limit filter for arrays
  eleventyConfig.addFilter("limit", function(arr, count) {
    if (!Array.isArray(arr)) return arr;
    return arr.slice(0, count);
  });

  // Render content: handles both HTML (existing) and markdown (from CMS)
  eleventyConfig.addFilter("renderContent", function(content) {
    if (!content) return '';
    var trimmed = content.trim();
    if (trimmed.startsWith('<')) return content;
    return md.render(content);
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};

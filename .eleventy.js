var markdownIt = require('markdown-it');
var md = markdownIt({ html: true, breaks: true, linkify: true });

var CLOUD_NAME = "ddcynsa30";
var CLOUD_BASE = "https://res.cloudinary.com/" + CLOUD_NAME;

module.exports = function(eleventyConfig) {
  // Pass through static assets
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/decap-cms");

  // ─── Cloudinary helpers ───────────────────────────────────────────
  // Usage in templates:
  //   {{ "yoga-bible/homepage/hero" | cloudimg }}
  //   {{ "yoga-bible/homepage/hero" | cloudimg("w_800,h_600,c_fill") }}
  //   {{ "yoga-bible/homepage/hero-loop" | cloudvid }}
  //   {{ "yoga-bible/homepage/hero-loop" | cloudvid("w_1280,q_auto") }}
  //
  // Shortcodes (for full <img> / <video> tags):
  //   {% cldimg "yoga-bible/homepage/hero", "Alt text", "w_800,c_fill", "800", "600" %}
  //   {% cldvid "yoga-bible/courses/inversions-reel", "poster-path", "w_1280" %}

  // Filter: returns optimized image URL
  eleventyConfig.addFilter("cloudimg", function(path, transforms) {
    var t = transforms || "f_auto,q_auto";
    return CLOUD_BASE + "/image/upload/" + t + "/" + path;
  });

  // Filter: returns optimized video URL
  eleventyConfig.addFilter("cloudvid", function(path, transforms) {
    var t = transforms || "f_auto,q_auto";
    return CLOUD_BASE + "/video/upload/" + t + "/" + path;
  });

  // Shortcode: renders full <img> tag with srcset for responsive
  eleventyConfig.addShortcode("cldimg", function(path, alt, transforms, width, height) {
    var t = transforms || "f_auto,q_auto";
    var src = CLOUD_BASE + "/image/upload/" + t + "/" + path;
    var srcset1x = CLOUD_BASE + "/image/upload/" + t + ",dpr_1.0/" + path;
    var srcset2x = CLOUD_BASE + "/image/upload/" + t + ",dpr_2.0/" + path;
    var wAttr = width ? ' width="' + width + '"' : '';
    var hAttr = height ? ' height="' + height + '"' : '';
    return '<img src="' + src + '" srcset="' + srcset1x + ' 1x, ' + srcset2x + ' 2x" alt="' + (alt || '') + '"' + wAttr + hAttr + ' loading="lazy" decoding="async">';
  });

  // Shortcode: renders <video> tag with autoplay loop (for hero/background)
  eleventyConfig.addShortcode("cldvid", function(path, poster, transforms) {
    var t = transforms || "f_auto,q_auto";
    var src = CLOUD_BASE + "/video/upload/" + t + "/" + path;
    var posterAttr = '';
    if (poster) {
      posterAttr = ' poster="' + CLOUD_BASE + '/image/upload/f_auto,q_auto/' + poster + '"';
    }
    return '<video' + posterAttr + ' autoplay loop muted playsinline><source src="' + src + '"></video>';
  });

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

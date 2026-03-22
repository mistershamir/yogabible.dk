var markdownIt = require('markdown-it');
var md = markdownIt({ html: true, breaks: true, linkify: true });
var Image = require('@11ty/eleventy-img');
var path = require('path');
var fs = require('fs');

var CLOUD_NAME = "ddcynsa30";
var CLOUD_BASE = "https://res.cloudinary.com/" + CLOUD_NAME;
var IMG_SRC_DIR = "src/assets/images";

// ─── Local image resolver ─────────────────────────────────────────
// Maps a Cloudinary public ID to a local file path.
// Returns the local path if found, null otherwise.
function resolveLocal(cloudPath) {
  if (!cloudPath) return null;
  // Strip yoga-bible-DK/ prefix → map to local folder structure
  var localRel = cloudPath.replace(/^yoga-bible-DK\//, '');
  // Strip Cloudinary version prefix (e.g. v1772433753/)
  localRel = localRel.replace(/^v\d+\//, '');
  var exts = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
  for (var i = 0; i < exts.length; i++) {
    var full = path.join(IMG_SRC_DIR, localRel + exts[i]);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

module.exports = function(eleventyConfig) {
  // Pass through static assets
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/assets");

  // ─── Image helpers (local-first, Cloudinary fallback) ─────────────
  //
  // Usage unchanged in templates:
  //   {{ "yoga-bible-DK/homepage/hero" | cloudimg }}
  //   {{ "yoga-bible-DK/homepage/hero" | cloudimg("w_800,h_600,c_fill") }}
  //   {% cldimg "yoga-bible-DK/homepage/hero", "Alt text", "w_800,c_fill", "800", "600" %}
  //   {% cldvid "yoga-bible-DK/homepage/hero-loop", "poster-path", "w_1280" %}
  //
  // Images are served from local /assets/images/ when available.
  // Falls back to Cloudinary CDN for images not yet downloaded.
  // Videos always served from Cloudinary (eleventy-img can't process video).

  // Filter: returns optimized image URL (local-first)
  eleventyConfig.addFilter("cloudimg", function(cloudPath, transforms) {
    if (!cloudPath) return '';
    var local = resolveLocal(cloudPath);
    if (local) {
      // Serve from local assets — browser gets the pre-optimized file
      return '/' + local.replace(/^src\//, '');
    }
    // Fallback to Cloudinary for images not yet downloaded
    var t = transforms || "f_auto,q_auto";
    return CLOUD_BASE + "/image/upload/" + t + "/" + cloudPath;
  });

  // Filter: returns video URL (always Cloudinary — can't process video locally)
  eleventyConfig.addFilter("cloudvid", function(path, transforms) {
    var t = transforms || "f_auto,q_auto";
    return CLOUD_BASE + "/video/upload/" + t + "/" + path;
  });

  // Shortcode: renders responsive <picture> tag via eleventy-img (local-first)
  eleventyConfig.addAsyncShortcode("cldimg", async function(cloudPath, alt, transforms, width, height) {
    if (!cloudPath) return '';
    var local = resolveLocal(cloudPath);

    if (local) {
      // ── Local file found → process with eleventy-img ──
      var isSvg = local.endsWith('.svg');
      if (isSvg) {
        // SVGs pass through as-is
        var svgUrl = '/' + local.replace(/^src\//, '');
        var wAttr = width ? ' width="' + width + '"' : '';
        var hAttr = height ? ' height="' + height + '"' : '';
        return '<img src="' + svgUrl + '" alt="' + (alt || '') + '"' + wAttr + hAttr + ' loading="lazy" decoding="async">';
      }

      // Parse desired width from transforms or width param
      var imgWidth = parseInt(width) || 800;
      if (transforms) {
        var wMatch = transforms.match(/w_(\d+)/);
        if (wMatch) imgWidth = parseInt(wMatch[1]);
      }
      // Generate 1x and 2x sizes (capped at source dimensions)
      var widths = [imgWidth, Math.min(imgWidth * 2, 3840)];

      try {
        var metadata = await Image(local, {
          widths: widths,
          formats: ['webp', 'jpeg'],
          outputDir: '_site/img/opt/',
          urlPath: '/img/opt/',
          filenameFormat: function(id, src, w, format) {
            var name = path.basename(src, path.extname(src));
            return name + '-' + w + 'w.' + format;
          },
          cacheOptions: { duration: '1y' }
        });

        // Build <picture> with WebP + JPEG fallback
        var webp = metadata.webp;
        var jpeg = metadata.jpeg;
        var srcsetWebp = webp.map(function(img) { return img.url + ' ' + img.width + 'w'; }).join(', ');
        var srcsetJpeg = jpeg.map(function(img) { return img.url + ' ' + img.width + 'w'; }).join(', ');
        var fallback = jpeg[0];
        var wAttr = width ? ' width="' + width + '"' : ' width="' + fallback.width + '"';
        var hAttr = height ? ' height="' + height + '"' : ' height="' + fallback.height + '"';

        return '<picture>' +
          '<source type="image/webp" srcset="' + srcsetWebp + '">' +
          '<source type="image/jpeg" srcset="' + srcsetJpeg + '">' +
          '<img src="' + fallback.url + '" alt="' + (alt || '') + '"' + wAttr + hAttr + ' loading="lazy" decoding="async" eleventy:ignore>' +
          '</picture>';
      } catch (e) {
        // If eleventy-img fails (corrupt file, etc.), serve original
        var rawUrl = '/' + local.replace(/^src\//, '');
        return '<img src="' + rawUrl + '" alt="' + (alt || '') + '" loading="lazy" decoding="async">';
      }
    }

    // ── Fallback: Cloudinary (image not yet downloaded) ──
    var t = transforms || "f_auto,q_auto";
    var src = CLOUD_BASE + "/image/upload/" + t + "/" + cloudPath;
    var srcset1x = CLOUD_BASE + "/image/upload/" + t + ",dpr_1.0/" + cloudPath;
    var srcset2x = CLOUD_BASE + "/image/upload/" + t + ",dpr_2.0/" + cloudPath;
    var wAttr = width ? ' width="' + width + '"' : '';
    var hAttr = height ? ' height="' + height + '"' : '';
    return '<img src="' + src + '" srcset="' + srcset1x + ' 1x, ' + srcset2x + ' 2x" alt="' + (alt || '') + '"' + wAttr + hAttr + ' loading="lazy" decoding="async">';
  });

  // Shortcode: renders <video> tag (always Cloudinary)
  eleventyConfig.addShortcode("cldvid", function(cloudPath, poster, transforms) {
    var t = transforms || "f_auto,q_auto";
    var src = CLOUD_BASE + "/video/upload/" + t + "/" + cloudPath;
    var posterAttr = '';
    if (poster) {
      // Check if poster image is available locally
      var localPoster = resolveLocal(poster);
      if (localPoster) {
        posterAttr = ' poster="/' + localPoster.replace(/^src\//, '') + '"';
      } else {
        posterAttr = ' poster="' + CLOUD_BASE + '/image/upload/f_auto,q_auto/' + poster + '"';
      }
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

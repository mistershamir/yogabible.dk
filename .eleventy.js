var markdownIt = require('markdown-it');
var md = markdownIt({ html: true, breaks: true, linkify: true });
var Image = require('@11ty/eleventy-img');
var path = require('path');
var fs = require('fs');

var CLOUD_NAME = "ddcynsa30";
var CLOUD_BASE = "https://res.cloudinary.com/" + CLOUD_NAME;
var IMG_SRC_DIR = "src/assets/images";
var VID_SRC_DIR = "src/assets/videos";

// ─── Local resolver: images ──────────────────────────────────────
function resolveLocal(cloudPath) {
  if (!cloudPath) return null;
  var localRel = cloudPath.replace(/^yoga-bible-DK\//, '');
  localRel = localRel.replace(/^v\d+\//, '');
  var exts = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
  for (var i = 0; i < exts.length; i++) {
    var full = path.join(IMG_SRC_DIR, localRel + exts[i]);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// ─── Local resolver: videos ──────────────────────────────────────
function resolveLocalVideo(cloudPath) {
  if (!cloudPath) return null;
  var localRel = cloudPath.replace(/^yoga-bible-DK\//, '');
  localRel = localRel.replace(/^v\d+\//, '');
  // Strip any existing extension
  localRel = localRel.replace(/\.(mp4|mov|webm)$/, '');
  var exts = ['.mp4', '.mov', '.webm'];
  for (var i = 0; i < exts.length; i++) {
    var full = path.join(VID_SRC_DIR, localRel + exts[i]);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// ─── Local resolver: poster frames (saved as images from video extracts) ──
function resolveLocalPoster(cloudPath) {
  if (!cloudPath) return null;
  var localRel = cloudPath.replace(/^yoga-bible-DK\//, '');
  localRel = localRel.replace(/^v\d+\//, '');
  // Poster frames are saved as .jpg in the images dir
  localRel = localRel.replace(/\.(jpg|png)$/, '');
  var exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (var i = 0; i < exts.length; i++) {
    var full = path.join(IMG_SRC_DIR, localRel + exts[i]);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

module.exports = function(eleventyConfig) {
  // ── Global data: Cloudinary base URL (fallback for not-yet-downloaded assets) ──
  // Once all assets are downloaded locally, this is only used as a build-time
  // fallback. The localMedia transform rewrites any remaining Cloudinary URLs
  // to local paths when the files exist.
  eleventyConfig.addGlobalData("mediaBase", CLOUD_BASE);

  // Passthrough filter (used in some templates for URL strings)
  eleventyConfig.addFilter("cdnUrl", function(val) { return val || ''; });

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
  // Images served from local /assets/images/ (eleventy-img generates WebP+JPEG).
  // Videos served from local /assets/videos/ when available.
  // Falls back to Cloudinary CDN for assets not yet downloaded locally.

  // Filter: returns optimized image URL (local-first, Cloudinary fallback)
  eleventyConfig.addFilter("cloudimg", function(cloudPath, transforms) {
    if (!cloudPath) return '';
    var local = resolveLocal(cloudPath);
    if (local) {
      return '/' + local.replace(/^src\//, '');
    }
    // Fallback to Cloudinary CDN for images not yet downloaded locally
    var t = transforms || "f_auto,q_auto";
    return CLOUD_BASE + "/image/upload/" + t + "/" + cloudPath;
  });

  // Filter: returns video URL (local-first, Cloudinary fallback)
  eleventyConfig.addFilter("cloudvid", function(vidPath, transforms) {
    if (!vidPath) return '';
    var local = resolveLocalVideo(vidPath);
    if (local) {
      return '/' + local.replace(/^src\//, '');
    }
    // Also check if it's a poster frame request (path ends with .jpg/.png)
    if (/\.(jpg|png)$/.test(vidPath)) {
      var poster = resolveLocalPoster(vidPath);
      if (poster) return '/' + poster.replace(/^src\//, '');
    }
    // Fallback to Cloudinary for videos not yet downloaded
    var t = transforms || "f_auto,q_auto";
    return CLOUD_BASE + "/video/upload/" + t + "/" + vidPath;
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

    // ── Fallback: Cloudinary CDN (image not yet downloaded locally) ──
    var t = transforms || "f_auto,q_auto";
    var src = CLOUD_BASE + "/image/upload/" + t + "/" + cloudPath;
    var srcset1x = CLOUD_BASE + "/image/upload/" + t + ",dpr_1.0/" + cloudPath;
    var srcset2x = CLOUD_BASE + "/image/upload/" + t + ",dpr_2.0/" + cloudPath;
    var wAttr = width ? ' width="' + width + '"' : '';
    var hAttr = height ? ' height="' + height + '"' : '';
    return '<img src="' + src + '" srcset="' + srcset1x + ' 1x, ' + srcset2x + ' 2x" alt="' + (alt || '') + '"' + wAttr + hAttr + ' loading="lazy" decoding="async">';
  });

  // Shortcode: renders <video> tag (local-first, Cloudinary fallback)
  eleventyConfig.addShortcode("cldvid", function(cloudPath, poster, transforms) {
    // Resolve video source
    var localVid = resolveLocalVideo(cloudPath);
    var src;
    if (localVid) {
      src = '/' + localVid.replace(/^src\//, '');
    } else {
      var t = transforms || "f_auto,q_auto";
      src = CLOUD_BASE + "/video/upload/" + t + "/" + cloudPath;
    }
    // Resolve poster image
    var posterAttr = '';
    if (poster) {
      var localPoster = resolveLocal(poster) || resolveLocalPoster(poster);
      if (localPoster) {
        posterAttr = ' poster="/' + localPoster.replace(/^src\//, '') + '"';
      } else {
        posterAttr = ' poster="' + CLOUD_BASE + '/image/upload/f_auto,q_auto/' + poster + '"';
      }
    }
    return '<video' + posterAttr + ' autoplay loop muted playsinline><source src="' + src + '"></video>';
  });

  // ─── HTML transform: rewrite remaining Cloudinary URLs to local paths ──
  // Catches {{ mediaBase }}/path and full Cloudinary URLs in rendered HTML.
  // Only rewrites if the local file exists; otherwise leaves the Cloudinary URL.
  var cloudinaryVideoRegex = /https:\/\/res\.cloudinary\.com\/ddcynsa30\/video\/upload\/(?:[a-zA-Z0-9_,.:]+\/)*((?:yoga-bible-DK|v\d+)\/.+?\.(mp4|mov|webm))/g;
  var cloudinaryImageRegex = /https:\/\/res\.cloudinary\.com\/ddcynsa30\/image\/upload\/(?:[a-zA-Z0-9_,.:]+\/)*((?:yoga-bible-DK|v\d+)\/.+?)(?=["'\s)<]|$)/g;
  var mediaBaseVideoRegex = /https:\/\/res\.cloudinary\.com\/ddcynsa30\/((?:yoga-bible-DK|v\d+)\/.+?\.(mp4|mov|webm))/g;

  eleventyConfig.addTransform("localMedia", function(content) {
    if (!this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;

    // Rewrite Cloudinary video URLs to local
    content = content.replace(cloudinaryVideoRegex, function(match, assetPath, ext) {
      var localVid = resolveLocalVideo(assetPath.replace(/\.(mp4|mov|webm)$/, ''));
      if (localVid) return '/' + localVid.replace(/^src\//, '');
      return match;
    });

    // Rewrite direct mediaBase video references (without /video/upload/ prefix)
    content = content.replace(mediaBaseVideoRegex, function(match, assetPath, ext) {
      var localVid = resolveLocalVideo(assetPath.replace(/\.(mp4|mov|webm)$/, ''));
      if (localVid) return '/' + localVid.replace(/^src\//, '');
      return match;
    });

    // Rewrite Cloudinary image URLs to local (catches any missed by filters)
    content = content.replace(cloudinaryImageRegex, function(match, assetPath) {
      var localImg = resolveLocal(assetPath);
      if (localImg) return '/' + localImg.replace(/^src\//, '');
      return match;
    });

    return content;
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

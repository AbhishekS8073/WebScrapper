import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { scrapeWithPlaywright, crawlSite, closeBrowser } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API info
app.get('/api', (req, res) => {
  res.json({
    name: 'Advanced Image Scraper API',
    version: '2.0.0',
    description: 'Advanced web scraping API with Playwright support',
    endpoints: {
      'POST /api/scrape': 'Scrape images from a URL using Playwright (recommended)',
      'POST /api/scrape/cheerio': 'Scrape images using Cheerio (faster, simpler pages)',
      'POST /api/crawl': 'Crawl entire website for images',
      'GET /api/health': 'Health check',
    },
    features: [
      'Playwright-based rendering for JavaScript-heavy sites',
      'Lazy loading detection',
      'Background image extraction',
      'Meta tag (OG/Twitter) image extraction',
      'Icon extraction',
      'Multi-page crawling',
      'Advanced filtering and metadata extraction',
    ]
  });
});

// Helper function to resolve relative URLs
const resolveUrl = (baseUrl, relativeUrl) => {
  try {
    if (!relativeUrl) return null;
    if (relativeUrl.startsWith('data:')) return null;
    const base = new URL(baseUrl);
    if (relativeUrl.startsWith('//')) {
      return base.protocol + relativeUrl;
    }
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
};

// Helper function to get metadata from HTML
const getMetaContent = ($, name) => {
  const selectors = [
    `meta[property="${name}"]`,
    `meta[name="${name}"]`,
    `meta[itemprop="${name}"]`
  ];
  
  for (const selector of selectors) {
    const content = $(selector).attr('content');
    if (content) return content;
  }
  return null;
};

// ============ MAIN SCRAPE ENDPOINT (Playwright - Recommended) ============
app.post('/api/scrape', async (req, res) => {
  try {
    const { url, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Use Playwright for advanced scraping
    const result = await scrapeWithPlaywright(url, {
      waitForNetworkIdle: options.waitForNetworkIdle ?? true,
      scrollToLoad: options.scrollToLoad ?? true,
      scrollDelay: options.scrollDelay ?? 1000,
      maxScrolls: options.maxScrolls ?? 5,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      url: result.pageMetadata.url,
      pageMetadata: result.pageMetadata,
      images: result.images,
      links: result.links,
      stats: result.stats,
      method: 'playwright'
    });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CHEERIO-BASED SCRAPER (Faster for simple pages) ============
app.post('/api/scrape/cheerio', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    let baseUrl;
    try {
      baseUrl = new URL(url).origin;
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Fetch the webpage
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    
    const images = [];
    const seenUrls = new Set();

    // Get page metadata
    const pageMetadata = {
      title: $('title').text() || getMetaContent($, 'og:title') || getMetaContent($, 'twitter:title'),
      description: getMetaContent($, 'description') || getMetaContent($, 'og:description') || getMetaContent($, 'twitter:description'),
      siteName: getMetaContent($, 'og:site_name'),
      author: getMetaContent($, 'author') || getMetaContent($, 'article:author'),
      publishedTime: getMetaContent($, 'article:published_time'),
      baseUrl: baseUrl,
      url: url,
      scrapedAt: new Date().toISOString(),
    };

    // Scrape from <img> tags
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      const srcset = $(el).attr('srcset');
      const alt = $(el).attr('alt') || '';
      const width = $(el).attr('width');
      const height = $(el).attr('height');
      const loading = $(el).attr('loading') || 'eager';
      const decoding = $(el).attr('decoding') || 'auto';
      
      let imageUrl = src;
      if (!imageUrl && srcset) {
        const firstSrc = srcset.split(',')[0]?.trim().split(' ')[0];
        imageUrl = firstSrc;
      }

      if (imageUrl) {
        const resolvedUrl = resolveUrl(url, imageUrl);
        if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
          seenUrls.add(resolvedUrl);
          images.push({
            url: resolvedUrl,
            alt: alt,
            width: width ? parseInt(width) : null,
            height: height ? parseInt(height) : null,
            loading: loading,
            decoding: decoding,
            source: 'img_tag',
            sourceTag: 'img'
          });
        }
      }

      // Check for lazy-src or data-src
      const lazySrc = $(el).attr('data-src') || $(el).attr('lazy-src') || $(el).data('src');
      if (lazySrc) {
        const resolvedUrl = resolveUrl(url, lazySrc);
        if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
          seenUrls.add(resolvedUrl);
          images.push({
            url: resolvedUrl,
            alt: alt,
            width: width ? parseInt(width) : null,
            height: height ? parseInt(height) : null,
            loading: 'lazy',
            decoding: decoding,
            source: 'lazy_loading',
            sourceTag: 'img'
          });
        }
      }
    });

    // Scrape from <picture> > <source> tags
    $('picture source').each((_, el) => {
      const srcset = $(el).attr('srcset');
      const media = $(el).attr('media');
      const type = $(el).attr('type');
      
      if (srcset) {
        const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
        urls.forEach(imageUrl => {
          const resolvedUrl = resolveUrl(url, imageUrl);
          if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
            seenUrls.add(resolvedUrl);
            images.push({
              url: resolvedUrl,
              alt: '',
              width: null,
              height: null,
              loading: 'eager',
              decoding: 'auto',
              source: 'picture_source',
              sourceTag: 'source',
              media: media,
              type: type
            });
          }
        });
      }
    });

    // Scrape from <figure> tags
    $('figure img').each((_, el) => {
      const src = $(el).attr('src');
      const alt = $(el).attr('alt') || '';
      
      if (src) {
        const resolvedUrl = resolveUrl(url, src);
        if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
          seenUrls.add(resolvedUrl);
          const figure = $(el).closest('figure');
          const figcaption = figure.find('figcaption').text() || '';
          
          images.push({
            url: resolvedUrl,
            alt: alt,
            width: null,
            height: null,
            loading: 'eager',
            decoding: 'auto',
            source: 'figure',
            sourceTag: 'figure',
            caption: figcaption
          });
        }
      }
    });

    // Scrape from inline styles (background-image)
    $('[style*="background-image"]').each((_, el) => {
      const style = $(el).attr('style');
      if (style) {
        const match = style.match(/url\(['"]?([^'")]+)['"]?\)/);
        if (match) {
          const resolvedUrl = resolveUrl(url, match[1]);
          if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
            seenUrls.add(resolvedUrl);
            images.push({
              url: resolvedUrl,
              alt: '',
              width: null,
              height: null,
              loading: 'eager',
              decoding: 'auto',
              source: 'background_image',
              sourceTag: $(el).prop('tagName')?.toLowerCase() || 'div',
            });
          }
        }
      }
    });

    // Get meta tags (og:image, twitter:image)
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ];
    
    metaSelectors.forEach(selector => {
      $(selector).each((_, el) => {
        const content = $(el).attr('content');
        if (content) {
          const resolvedUrl = resolveUrl(url, content);
          if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
            seenUrls.add(resolvedUrl);
            images.push({
              url: resolvedUrl,
              alt: '',
              width: null,
              height: null,
              loading: 'eager',
              decoding: 'auto',
              source: 'meta_image',
              sourceTag: 'meta',
              metaType: $(el).attr('property') || $(el).attr('name'),
            });
          }
        }
      });
    });

    // Get favicon and icons
    const iconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
    ];
    
    iconSelectors.forEach(selector => {
      $(selector).each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          const resolvedUrl = resolveUrl(url, href);
          if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
            seenUrls.add(resolvedUrl);
            images.push({
              url: resolvedUrl,
              alt: '',
              width: null,
              height: null,
              loading: 'eager',
              decoding: 'auto',
              source: 'icon',
              sourceTag: 'link',
              rel: $(el).attr('rel'),
              sizes: $(el).attr('sizes'),
            });
          }
        }
      });
    });

    // Get all links from the page
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const resolvedUrl = resolveUrl(url, href);
        if (resolvedUrl && resolvedUrl.startsWith(baseUrl)) {
          links.push(resolvedUrl);
        }
      }
    });

    res.json({
      success: true,
      url: url,
      pageMetadata: pageMetadata,
      images: images,
      links: [...new Set(links)].slice(0, 50),
      stats: {
        totalImages: images.length,
        bySource: images.reduce((acc, img) => {
          acc[img.source] = (acc[img.source] || 0) + 1;
          return acc;
        }, {}),
      },
      method: 'cheerio'
    });

  } catch (error) {
    console.error('Cheerio scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CRAWLER ENDPOINT ============
app.post('/api/crawl', async (req, res) => {
  try {
    const { url, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const result = await crawlSite(url, {
      maxPages: options.maxPages || 5,
      maxImagesPerPage: options.maxImagesPerPage || 50,
      followInternalLinks: options.followInternalLinks ?? true,
      respectRobots: options.respectRobots ?? true,
    });

    res.json({
      success: true,
      ...result,
      method: 'crawler'
    });

  } catch (error) {
    console.error('Crawling error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ADVANCED SCRAPING OPTIONS ============
app.post('/api/scrape/advanced', async (req, res) => {
  try {
    const { 
      url, 
      options = {},
      scrapeOptions = {}
    } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Use Playwright with custom options
    const result = await scrapeWithPlaywright(url, {
      waitForNetworkIdle: scrapeOptions.waitForNetworkIdle ?? true,
      scrollToLoad: scrapeOptions.scrollToLoad ?? true,
      scrollDelay: scrapeOptions.scrollDelay ?? 1000,
      maxScrolls: scrapeOptions.maxScrolls ?? 5,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Apply additional filtering
    let filteredImages = result.images;
    
    if (options.filter) {
      if (options.filter.withAlt) {
        filteredImages = filteredImages.filter(img => img.alt && img.alt.length > 0);
      }
      if (options.filter.minWidth) {
        filteredImages = filteredImages.filter(img => img.width >= options.filter.minWidth);
      }
      if (options.filter.sources) {
        filteredImages = filteredImages.filter(img => 
          options.filter.sources.includes(img.source)
        );
      }
    }

    res.json({
      success: true,
      url: result.pageMetadata.url,
      pageMetadata: result.pageMetadata,
      images: filteredImages,
      allImages: result.images,
      links: result.links,
      stats: {
        totalImages: result.images.length,
        filteredCount: filteredImages.length,
        bySource: result.stats.bySource,
      },
      method: 'playwright-advanced',
      filters: options.filter || {}
    });

  } catch (error) {
    console.error('Advanced scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ BATCH SCRAPING ============
app.post('/api/scrape/batch', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    const results = await Promise.allSettled(
      urls.slice(0, 10).map(async (url) => {
        try {
          const result = await scrapeWithPlaywright(url);
          return {
            url,
            success: result.success,
            images: result.images,
            error: result.error
          };
        } catch (error) {
          return {
            url,
            success: false,
            error: error.message,
            images: []
          };
        }
      })
    );

    const processedResults = results.map((r, index) => {
      if (r.status === 'fulfilled') {
        return r.value;
      }
      return {
        url: urls[index],
        success: false,
        error: r.reason?.message || 'Unknown error',
        images: []
      };
    });

    res.json({
      success: true,
      totalUrls: urls.length,
      processedUrls: processedResults.length,
      results: processedResults,
      summary: {
        successful: processedResults.filter(r => r.success).length,
        failed: processedResults.filter(r => !r.success).length,
        totalImages: processedResults.reduce((sum, r) => sum + (r.images?.length || 0), 0),
      }
    });

  } catch (error) {
    console.error('Batch scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ IMAGE ANALYSIS ============
app.post('/api/analyze/image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    // Get image headers and basic info
    const response = await axios.head(imageUrl, {
      timeout: 10000,
      validateStatus: () => true,
    });

    res.json({
      success: true,
      url: imageUrl,
      headers: {
        contentType: response.headers['content-type'],
        contentLength: response.headers['content-length'],
        lastModified: response.headers['last-modified'],
        etag: response.headers['etag'],
        cacheControl: response.headers['cache-control'],
      },
      status: response.status,
      isImage: response.headers['content-type']?.startsWith('image/'),
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing browser...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing browser...');
  await closeBrowser();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Advanced Image Scraper API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   API Info: http://localhost:${PORT}/api`);
});

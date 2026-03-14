import { chromium } from 'playwright';

// Cache for browser instance
let browser = null;
let browserPromise = null;

const getBrowser = async () => {
  if (browser && browser.isConnected()) {
    return browser;
  }
  
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--allow-running-insecure-content',
      ]
    }).then(b => {
      browser = b;
      return b;
    });
  }
  
  return browserPromise;
};

// Helper to resolve relative URLs
export const resolveUrl = (baseUrl, relativeUrl) => {
  try {
    if (!relativeUrl) return null;
    if (relativeUrl.startsWith('data:')) return null;
    if (relativeUrl.startsWith('//')) {
      const base = new URL(baseUrl);
      return base.protocol + relativeUrl;
    }
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
};

// Helper to get meta content
export const getMetaContent = ($, name) => {
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

// Playwright-based scraper
export const scrapeWithPlaywright = async (url, options = {}) => {
  const {
    waitForNetworkIdle = true,
    waitForSelector = 'body',
    scrollToLoad = true,
    scrollDelay = 1000,
    maxScrolls = 5,
  } = options;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  const images = [];
  const seenUrls = new Set();

  try {
    // Navigate to URL
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for initial content
    await page.waitForSelector(waitForSelector, { timeout: 10000 });
    
    // Wait for network idle if requested
    if (waitForNetworkIdle) {
      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch (e) {
        // Continue even if network idle fails
      }
    }

    // Scroll to load lazy images
    if (scrollToLoad) {
      for (let i = 0; i < maxScrolls; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(scrollDelay);
        
        // Check if we need to continue scrolling
        const scrollPosition = await page.evaluate(() => ({
          scrollTop: window.scrollY,
          scrollHeight: document.body.scrollHeight,
          clientHeight: window.innerHeight
        }));
        
        // If we've reached the bottom, stop scrolling
        if (scrollPosition.scrollTop + scrollPosition.clientHeight >= scrollPosition.scrollHeight - 100) {
          break;
        }
      }
      // Scroll back to top
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // Extract all image data using page.evaluate
    const imageData = await page.evaluate(() => {
      const results = [];
      
      // 1. Get all <img> tags
      document.querySelectorAll('img').forEach(img => {
        results.push({
          tag: 'img',
          src: img.src,
          srcset: img.srcset,
          alt: img.alt || '',
          loading: img.loading || 'eager',
          decoding: img.decoding || 'auto',
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: img.getAttribute('width'),
          height: img.getAttribute('height'),
          dataSrc: img.dataset.src || img.dataset.lazySrc || img.getAttribute('data-src'),
          dataSrcSet: img.dataset.srcset,
          parent: img.parentElement?.tagName || '',
          className: img.className || '',
          id: img.id || '',
        });
      });

      // 2. Get all <picture> > <source> tags
      document.querySelectorAll('picture source').forEach(source => {
        results.push({
          tag: 'source',
          srcset: source.srcset,
          media: source.media,
          type: source.type,
          parent: 'picture',
        });
      });

      // 3. Get all <figure> images
      document.querySelectorAll('figure img').forEach(img => {
        const figure = img.closest('figure');
        results.push({
          tag: 'figure',
          src: img.src,
          alt: img.alt || '',
          figcaption: figure?.querySelector('figcaption')?.textContent || '',
          parent: 'figure',
        });
      });

      // 4. Get elements with background-image
      document.querySelectorAll('*').forEach(el => {
        const style = el.style?.backgroundImage || el.computedStyleMap?.()?.get('background-image')?.toString();
        if (style && style !== 'none' && style.includes('url')) {
          const match = style.match(/url\(['"]?([^'")]+)['"]?\)/);
          if (match) {
            results.push({
              tag: 'background',
              src: match[1],
              parent: el.tagName,
              className: el.className || '',
            });
          }
        }
      });

      // 5. Get meta tags (og:image, twitter:image)
      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[property="og:image:url"]',
        'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
        'meta[property="og:image:width"]',
        'meta[property="og:image:height"]',
      ];
      
      metaSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
          results.push({
            tag: 'meta',
            property: selector.match(/og:|twitter:/)?.[0]?.replace(':', '') || 'meta',
            content: el.getAttribute('content'),
            name: el.getAttribute('property') || el.getAttribute('name'),
          });
        }
      });

      // 6. Get link icons
      const iconSelectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
        'link[rel="apple-touch-icon-precomposed"]',
      ];
      
      iconSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          results.push({
            tag: 'icon',
            rel: el.getAttribute('rel'),
            href: el.getAttribute('href'),
            sizes: el.getAttribute('sizes'),
          });
        });
      });

      // 7. Get CSS background images from computed styles
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        try {
          const computedStyle = window.getComputedStyle(el);
          const bgImage = computedStyle.backgroundImage;
          if (bgImage && bgImage !== 'none' && bgImage.includes('url')) {
            const matches = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/g);
            if (matches) {
              matches.forEach(m => {
                const urlMatch = m.match(/url\(['"]?([^'")]+)['"]?\)/);
                if (urlMatch) {
                  results.push({
                    tag: 'css-background',
                    src: urlMatch[1],
                    parent: el.tagName,
                    className: el.className || '',
                  });
                }
              });
            }
          }
        } catch (e) {
          // Skip elements that can't be accessed
        }
      });

      // 8. Get video posters and sources
      document.querySelectorAll('video[poster], video source').forEach(el => {
        if (el.tagName === 'SOURCE') {
          results.push({
            tag: 'video',
            src: el.src,
            type: el.type,
            parent: 'video',
          });
        } else {
          results.push({
            tag: 'video',
            src: el.poster,
            parent: 'video',
          });
        }
      });

      // 9. Get SVG images
      document.querySelectorAll('image[href], use[href]').forEach(el => {
        results.push({
          tag: 'svg',
          src: el.href?.baseVal || el.getAttribute('href'),
          parent: 'svg',
        });
      });

      // 10. Get data attributes that might contain URLs
      document.querySelectorAll('[data-bg], [data-background], [data-img], [data-image], [data-thumb], [data-thumbnail]').forEach(el => {
        ['data-bg', 'data-background', 'data-img', 'data-image', 'data-thumb', 'data-thumbnail'].forEach(attr => {
          const val = el.getAttribute(attr);
          if (val && (val.startsWith('http') || val.startsWith('/') || val.startsWith('./') || val.startsWith('../'))) {
            results.push({
              tag: 'data-attr',
              src: val,
              attribute: attr,
              parent: el.tagName,
            });
          }
        });
      });

      return results;
    });

    // Process and deduplicate images
    const processImage = (src, source, extraData = {}) => {
      if (!src) return null;
      const resolvedUrl = resolveUrl(url, src);
      if (!resolvedUrl || seenUrls.has(resolvedUrl) || resolvedUrl.startsWith('data:')) return null;
      
      seenUrls.add(resolvedUrl);
      return {
        url: resolvedUrl,
        source,
        ...extraData
      };
    };

    // Process each image type
    imageData.forEach(data => {
      switch (data.tag) {
        case 'img':
          if (data.src) {
            const img = processImage(data.src, 'img_tag', {
              alt: data.alt,
              width: data.naturalWidth || (data.width ? parseInt(data.width) : null),
              height: data.naturalHeight || (data.height ? parseInt(data.height) : null),
              loading: data.loading,
              decoding: data.decoding,
              sourceTag: 'img',
              className: data.className,
            });
            if (img) images.push(img);
          }
          // Also check data-src
          if (data.dataSrc) {
            const lazyImg = processImage(data.dataSrc, 'lazy_loading', {
              alt: data.alt,
              loading: 'lazy',
              sourceTag: 'img',
              className: data.className,
            });
            if (lazyImg) images.push(lazyImg);
          }
          break;

        case 'source':
          if (data.srcset) {
            data.srcset.split(',').forEach(src => {
              const srcUrl = src.trim().split(' ')[0];
              const img = processImage(srcUrl, 'picture_source', {
                media: data.media,
                type: data.type,
                sourceTag: 'source',
              });
              if (img) images.push(img);
            });
          }
          break;

        case 'figure':
          if (data.src) {
            const img = processImage(data.src, 'figure', {
              alt: data.figcaption || data.alt,
              caption: data.figcaption,
              sourceTag: 'figure',
            });
            if (img) images.push(img);
          }
          break;

        case 'background':
        case 'css-background':
          const bgImg = processImage(data.src, 'background_image', {
            parent: data.parent,
            className: data.className,
            sourceTag: data.tag,
          });
          if (bgImg) images.push(bgImg);
          break;

        case 'meta':
          if (data.content) {
            const metaImg = processImage(data.content, 'meta_image', {
              metaType: data.name,
              sourceTag: 'meta',
            });
            if (metaImg) images.push(metaImg);
          }
          break;

        case 'icon':
          if (data.href) {
            const iconImg = processImage(data.href, 'icon', {
              rel: data.rel,
              sizes: data.sizes,
              sourceTag: 'link',
            });
            if (iconImg) images.push(iconImg);
          }
          break;

        case 'video':
          if (data.src) {
            const vidImg = processImage(data.src, 'video_poster', {
              type: data.type,
              sourceTag: data.tag,
            });
            if (vidImg) images.push(vidImg);
          }
          break;

        case 'data-attr':
          const dataImg = processImage(data.src, 'data_attribute', {
            attribute: data.attribute,
            parent: data.parent,
            sourceTag: 'data',
          });
          if (dataImg) images.push(dataImg);
          break;
      }
    });

    // Get page metadata
    const pageMetadata = await page.evaluate(() => {
      const getMeta = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el.getAttribute('content') || el.getAttribute('value');
        }
        return null;
      };

      return {
        title: document.title || getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']),
        description: getMeta(['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']),
        siteName: getMeta(['meta[property="og:site_name"]']),
        author: getMeta(['meta[name="author"]', 'meta[property="article:author"]']),
        url: window.location.href,
        canonical: getMeta(['link[rel="canonical"]']),
        keywords: getMeta(['meta[name="keywords"]']),
        locale: getMeta(['meta[property="og:locale"]']),
        type: getMeta(['meta[property="og:type"]']),
      };
    });

    // Get all links for crawling
    const links = await page.evaluate(() => {
      const baseUrl = window.location.origin;
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        try {
          const href = a.href;
          if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
            // Only get links from the same domain
            if (href.startsWith(baseUrl) || href.startsWith('/')) {
              const resolved = new URL(href, baseUrl).href;
              if (resolved.startsWith(baseUrl) && !links.includes(resolved)) {
                links.push(resolved);
              }
            }
          }
        } catch (e) {}
      });
      return links.slice(0, 50); // Limit to 50 links
    });

    return {
      success: true,
      images,
      pageMetadata: {
        ...pageMetadata,
        baseUrl: new URL(url).origin,
        scrapedAt: new Date().toISOString(),
      },
      links,
      stats: {
        totalImages: images.length,
        bySource: images.reduce((acc, img) => {
          acc[img.source] = (acc[img.source] || 0) + 1;
          return acc;
        }, {}),
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      images: [],
      pageMetadata: {},
      links: [],
    };
  } finally {
    await context.close();
  }
};

// Crawler to scrape multiple pages
export const crawlSite = async (url, options = {}) => {
  const {
    maxPages = 5,
    maxImagesPerPage = 50,
    followInternalLinks = true,
    respectRobots = true,
  } = options;

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const baseUrl = new URL(url).origin;
  const visitedUrls = new Set();
  const allImages = [];
  const allLinks = [];
  const seenUrls = new Set();

  // Queue of URLs to visit
  const queue = [url];
  
  // Check robots.txt if requested
  let robotsTxt = null;
  if (respectRobots) {
    try {
      const robotsResponse = await page.goto(`${baseUrl}/robots.txt`, { timeout: 5000 }).catch(() => null);
      if (robotsResponse) {
        robotsTxt = await robotsResponse.text();
      }
    } catch (e) {
      // No robots.txt found
    }
  }

  const processUrl = (href) => {
    try {
      if (href.startsWith('http')) {
        return href;
      } else if (href.startsWith('/')) {
        return baseUrl + href;
      }
      return null;
    } catch {
      return null;
    }
  };

  let pagesCrawled = 0;

  while (queue.length > 0 && pagesCrawled < maxPages) {
    const currentUrl = queue.shift();
    
    if (visitedUrls.has(currentUrl) || !currentUrl.startsWith(baseUrl)) {
      continue;
    }
    
    visitedUrls.add(currentUrl);
    pagesCrawled++;

    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      
      // Wait for content to load
      await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
      
      // Scroll to load lazy content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      // Extract images from this page
      const pageImages = await page.evaluate(() => {
        const images = [];
        const seen = new Set();
        
        // Regular img tags
        document.querySelectorAll('img').forEach(img => {
          const src = img.src || img.dataset.src;
          if (src && !src.startsWith('data:') && !seen.has(src)) {
            seen.add(src);
            images.push({
              url: src,
              alt: img.alt || '',
              pageUrl: window.location.href,
              source: 'img_tag'
            });
          }
        });

        // Background images
        document.querySelectorAll('*').forEach(el => {
          try {
            const style = window.getComputedStyle(el).backgroundImage;
            if (style && style !== 'none' && style.includes('url')) {
              const match = style.match(/url\(['"]?([^'")]+)['"]?\)/);
              if (match && !seen.has(match[1])) {
                seen.add(match[1]);
                images.push({
                  url: match[1],
                  alt: '',
                  pageUrl: window.location.href,
                  source: 'background_image'
                });
              }
            }
          } catch {}
        });

        // Meta og:image
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage && !seen.has(ogImage.content)) {
          seen.add(ogImage.content);
          images.push({
            url: ogImage.content,
            alt: '',
            pageUrl: window.location.href,
            source: 'og_image'
          });
        }

        return images;
      });

      // Add images from this page
      pageImages.forEach(img => {
        if (!seenUrls.has(img.url) && allImages.length < maxImagesPerPage * maxPages) {
          seenUrls.add(img.url);
          allImages.push(img);
        }
      });

      // Extract links for crawling if requested
      if (followInternalLinks && queue.length < maxPages) {
        const pageLinks = await page.evaluate(() => {
          const links = [];
          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.href;
            if (href && !href.includes('#') && !href.includes('?') === false) {
              links.push(href);
            }
          });
          return links;
        });

        pageLinks.forEach(link => {
          const processedUrl = processUrl(link);
          if (processedUrl && 
              processedUrl.startsWith(baseUrl) && 
              !visitedUrls.has(processedUrl) && 
              !queue.includes(processedUrl) &&
              allLinks.length < 100) {
            allLinks.push(processedUrl);
            queue.push(processedUrl);
          }
        });
      }

    } catch (error) {
      console.error(`Error crawling ${currentUrl}:`, error.message);
    }
  }

  await context.close();

  return {
    success: true,
    baseUrl,
    pagesCrawled,
    totalImages: allImages.length,
    images: allImages,
    crawledUrls: Array.from(visitedUrls),
    allDiscoveredLinks: allLinks.slice(0, 20),
    robotsTxt,
  };
};

// Close browser on shutdown
export const closeBrowser = async () => {
  if (browser) {
    await browser.close();
    browser = null;
    browserPromise = null;
  }
};

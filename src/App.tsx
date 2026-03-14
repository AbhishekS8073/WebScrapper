import { useState } from 'react';

interface ImageData {
  url: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
  loading?: string;
  decoding?: string;
  source: string;
  sourceTag?: string;
  media?: string;
  type?: string;
  caption?: string;
  metaType?: string;
  rel?: string;
  sizes?: string;
  parent?: string;
  className?: string;
  attribute?: string;
  pageUrl?: string;
}

interface PageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  publishedTime?: string;
  baseUrl?: string;
  url?: string;
  scrapedAt?: string;
  canonical?: string;
  keywords?: string;
  locale?: string;
  type?: string;
}

interface Stats {
  totalImages: number;
  bySource?: Record<string, number>;
  filteredCount?: number;
}

interface ScrapeResult {
  success: boolean;
  url: string;
  pageMetadata: PageMetadata;
  images: ImageData[];
  links?: string[];
  stats?: Stats;
  method?: string;
  filters?: Record<string, unknown>;
}

type ScrapeMethod = 'playwright' | 'cheerio' | 'crawl' | 'advanced';
type SortOption = 'source' | 'loading' | 'alt' | 'width' | 'none';
type FilterOption = 'all' | 'with-alt' | 'without-alt' | 'og-image' | 'lazy' | 'icons' | 'backgrounds' | 'meta';

function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [method, setMethod] = useState<ScrapeMethod>('playwright');
  const [crawlOptions, setCrawlOptions] = useState({ maxPages: 3 });
  const [sortBy, setSortBy] = useState<SortOption>('source');
  const [filterBy, setFilterBy] = useState<FilterOption>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [showApiPanel, setShowApiPanel] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [showBatch, setShowBatch] = useState(false);

  const handleScrape = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    try {
      new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    let endpoint = '/api/scrape';
    let body: Record<string, unknown> = { url: fullUrl };

    switch (method) {
      case 'cheerio':
        endpoint = '/api/scrape/cheerio';
        break;
      case 'crawl':
        endpoint = '/api/crawl';
        body = { url: fullUrl, options: crawlOptions };
        break;
      case 'advanced':
        endpoint = '/api/scrape/advanced';
        body = { url: fullUrl, options: {}, scrapeOptions: { scrollToLoad: true, maxScrolls: 5 } };
        break;
      default:
        endpoint = '/api/scrape';
    }

    try {
      const response = await fetch(`http://localhost:3001${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to scrape the website');
      }

      // Normalize the response for display
      const normalized: ScrapeResult = {
        success: data.success,
        url: data.url || fullUrl,
        pageMetadata: data.pageMetadata || {},
        images: data.images || [],
        links: data.links || [],
        stats: data.stats || { totalImages: data.images?.length || 0 },
        method: data.method,
      };

      setResult(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchScrape = async () => {
    const urls = batchUrls.split('\n').map(u => u.trim()).filter(u => u);
    
    if (urls.length === 0) {
      setError('Please enter at least one URL');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:3001/api/scrape/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Batch scrape failed');
      }

      // Combine all images from batch results
      const allImages: ImageData[] = [];
      data.results?.forEach((r: { success: boolean; images?: ImageData[]; url?: string }) => {
        if (r.success && r.images) {
          allImages.push(...r.images.map((img: ImageData) => ({ ...img, pageUrl: r.url || '' })));
        }
      });

      setResult({
        success: true,
        url: 'Batch Results',
        pageMetadata: { title: `Batch: ${urls.length} sites` },
        images: allImages,
        links: [],
        stats: {
          totalImages: allImages.length,
          bySource: allImages.reduce((acc: Record<string, number>, img) => {
            acc[img.source] = (acc[img.source] || 0) + 1;
            return acc;
          }, {}),
        },
        method: 'batch',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedImages = () => {
    if (!result) return [];

    let images = [...result.images];

    // Apply filters
    switch (filterBy) {
      case 'with-alt':
        images = images.filter(img => img.alt && img.alt.length > 0);
        break;
      case 'without-alt':
        images = images.filter(img => !img.alt || img.alt.length === 0);
        break;
      case 'og-image':
        images = images.filter(img => img.source === 'meta_image' || img.source === 'og_image');
        break;
      case 'lazy':
        images = images.filter(img => img.loading === 'lazy');
        break;
      case 'icons':
        images = images.filter(img => img.source === 'icon' || img.sourceTag === 'link');
        break;
      case 'backgrounds':
        images = images.filter(img => img.source === 'background_image' || img.source === 'css-background');
        break;
      case 'meta':
        images = images.filter(img => img.source === 'meta_image');
        break;
    }

    // Apply sorting
    switch (sortBy) {
      case 'source':
        images.sort((a, b) => a.source.localeCompare(b.source));
        break;
      case 'loading':
        images.sort((a, b) => (a.loading || 'eager').localeCompare(b.loading || 'eager'));
        break;
      case 'alt':
        images.sort((a, b) => {
          if (a.alt && !b.alt) return -1;
          if (!a.alt && b.alt) return 1;
          return (a.alt || '').localeCompare(b.alt || '');
        });
        break;
      case 'width':
        images.sort((a, b) => (b.width || 0) - (a.width || 0));
        break;
    }

    return images;
  };

  const getSourceColor = (source: string) => {
    const colors: Record<string, string> = {
      'meta_image': 'bg-blue-100 text-blue-800',
      'og_image': 'bg-blue-100 text-blue-800',
      'twitter_image': 'bg-sky-100 text-sky-800',
      'img_tag': 'bg-green-100 text-green-800',
      'picture_source': 'bg-purple-100 text-purple-800',
      'figure': 'bg-yellow-100 text-yellow-800',
      'background_image': 'bg-orange-100 text-orange-800',
      'css-background': 'bg-orange-100 text-orange-800',
      'lazy_loading': 'bg-pink-100 text-pink-800',
      'icon': 'bg-gray-100 text-gray-800',
      'video_poster': 'bg-red-100 text-red-800',
      'data_attribute': 'bg-teal-100 text-teal-800',
    };
    return colors[source] || 'bg-gray-100 text-gray-800';
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <span className="text-4xl">🕸️</span>
                Advanced Web Scraper
              </h1>
              <p className="text-purple-300 mt-1">Extract images & data with Playwright-powered crawling</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowApiPanel(!showApiPanel)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
              >
                📡 API Docs
              </button>
              <div className="text-right">
                <span className="text-xs text-gray-400">Current Method</span>
                <p className="text-sm text-white font-mono uppercase">{method}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* API Documentation Panel */}
      {showApiPanel && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-6 border border-white/10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">API Endpoints</h3>
              <button onClick={() => setShowApiPanel(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="bg-white/5 rounded-lg p-4">
                <code className="text-purple-400">POST /api/scrape</code>
                <p className="text-gray-400 mt-1">Playwright-based scraping (recommended)</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <code className="text-purple-400">POST /api/scrape/cheerio</code>
                <p className="text-gray-400 mt-1">Fast Cheerio-based scraping</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <code className="text-purple-400">POST /api/crawl</code>
                <p className="text-gray-400 mt-1">Multi-page site crawling</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <code className="text-purple-400">POST /api/scrape/batch</code>
                <p className="text-gray-400 mt-1">Batch scrape multiple URLs</p>
              </div>
            </div>
            <div className="mt-4 bg-black/30 rounded-lg p-4">
              <p className="text-gray-400 text-xs font-mono break-all">
                curl -X POST http://localhost:3001/api/scrape -H &quot;Content-Type: application/json&quot; -d '{'{'}&quot;url&quot;:&quot;https://example.com&quot;{'}'}'
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Toggle Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setShowBatch(false)}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${!showBatch ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
          >
            🔍 Single URL
          </button>
          <button
            onClick={() => setShowBatch(true)}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${showBatch ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
          >
            📋 Batch Mode
          </button>
        </div>

        {/* Search Forms */}
        {!showBatch ? (
          <form onSubmit={handleScrape} className="mb-8">
            {/* Method Selector */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { id: 'playwright', label: '⚡ Playwright', desc: 'Best for JS sites' },
                { id: 'cheerio', label: '🚀 Cheerio', desc: 'Fast & simple' },
                { id: 'crawl', label: '🕷️ Crawler', desc: 'Multi-page' },
                { id: 'advanced', label: '🎯 Advanced', desc: 'With filters' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id as ScrapeMethod)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    method === m.id
                      ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                      : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  }`}
                >
                  <span className="block">{m.label}</span>
                  <span className="text-xs opacity-70">{m.desc}</span>
                </button>
              ))}
            </div>

            {/* Crawl Options */}
            {method === 'crawl' && (
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2 text-white">
                  <span>Max Pages:</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={crawlOptions.maxPages}
                    onChange={(e) => setCrawlOptions({ maxPages: parseInt(e.target.value) || 3 })}
                    className="w-20 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white"
                  />
                </label>
              </div>
            )}

            <div className="flex gap-4 max-w-3xl mx-auto">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Enter website URL (e.g., https://example.com)"
                  className="w-full px-5 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-lg"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Scraping...
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    Scrape
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="mb-8">
            <textarea
              value={batchUrls}
              onChange={(e) => setBatchUrls(e.target.value)}
              placeholder="Enter URLs (one per line)
https://example.com
https://google.com
https://github.com"
              className="w-full h-32 px-5 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg mb-4"
            />
            <button
              onClick={handleBatchScrape}
              disabled={loading}
              className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <span>📋</span>
                  Batch Scrape
                </>
              )}
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="max-w-3xl mx-auto mb-8 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Stats & Controls */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                {/* Page Info */}
                <div>
                  <h2 className="text-xl font-semibold text-white">{result.pageMetadata.title || 'Untitled'}</h2>
                  <p className="text-purple-300 text-sm flex items-center gap-2">
                    {result.url}
                    {result.method && (
                      <span className="px-2 py-0.5 bg-purple-600/30 rounded text-xs">{result.method}</span>
                    )}
                  </p>
                  {result.pageMetadata.description && (
                    <p className="text-gray-400 text-sm mt-1 line-clamp-1">{result.pageMetadata.description}</p>
                  )}
                </div>
                
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Filter */}
                  <select
                    value={filterBy}
                    onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                    className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="all">All Images</option>
                    <option value="with-alt">With Alt Text</option>
                    <option value="without-alt">Without Alt</option>
                    <option value="og-image">OG/Twitter Images</option>
                    <option value="lazy">Lazy Loaded</option>
                    <option value="icons">Icons</option>
                    <option value="backgrounds">Backgrounds</option>
                    <option value="meta">Meta Tags</option>
                  </select>

                  {/* Sort */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="source">Sort by Source</option>
                    <option value="loading">Sort by Loading</option>
                    <option value="alt">Sort by Alt</option>
                    <option value="width">Sort by Width</option>
                    <option value="none">No Sort</option>
                  </select>

                  {/* View Toggle */}
                  <div className="flex bg-white/10 rounded-lg p-1">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`px-3 py-1 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      ▦ Grid
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`px-3 py-1 rounded-md transition-colors ${viewMode === 'list' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      ☰ List
                    </button>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-400 text-xs uppercase tracking-wider">Total Images</p>
                  <p className="text-2xl font-bold text-white">{result.stats?.totalImages || result.images.length}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-400 text-xs uppercase tracking-wider">With Alt Text</p>
                  <p className="text-2xl font-bold text-green-400">{result.images.filter(i => i.alt && i.alt.length > 0).length}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-400 text-xs uppercase tracking-wider">Sources</p>
                  <p className="text-2xl font-bold text-purple-400">{Object.keys(result.stats?.bySource || {}).length}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-400 text-xs uppercase tracking-wider">Lazy Loaded</p>
                  <p className="text-2xl font-bold text-yellow-400">{result.images.filter(i => i.loading === 'lazy').length}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-400 text-xs uppercase tracking-wider">Links Found</p>
                  <p className="text-2xl font-bold text-blue-400">{result.links?.length || 0}</p>
                </div>
              </div>

              {/* Source Legend */}
              {result.stats?.bySource && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Source Breakdown</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.stats.bySource).map(([source, count]) => (
                      <span key={source} className={`px-3 py-1 rounded-full text-xs font-medium ${getSourceColor(source)}`}>
                        {source}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Image Gallery */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  Images ({filteredAndSortedImages().length})
                </h3>
                <button
                  onClick={() => {
                    const data = JSON.stringify(result.images, null, 2);
                    const blob = new Blob([data], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'scraped-images.json';
                    a.click();
                  }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
                >
                  💾 Export JSON
                </button>
              </div>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {filteredAndSortedImages().map((img, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedImage(img)}
                      className="bg-white/10 rounded-xl overflow-hidden border border-white/10 hover:border-purple-500 transition-all cursor-pointer group"
                    >
                      <div className="aspect-square bg-black/20 relative">
                        <img
                          src={img.url}
                          alt={img.alt || 'Image'}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50%" x="50%" dominant-baseline="middle" text-anchor="middle" font-size="20">🖼️</text></svg>';
                          }}
                        />
                        <div className="absolute top-2 right-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${getSourceColor(img.source)}`}>
                            {img.source}
                          </span>
                        </div>
                      </div>
                      {img.alt && (
                        <p className="p-2 text-xs text-gray-300 truncate">{img.alt}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAndSortedImages().map((img, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedImage(img)}
                      className="bg-white/10 rounded-xl p-4 border border-white/10 hover:border-purple-500 transition-all cursor-pointer flex items-center gap-4"
                    >
                      <img
                        src={img.url}
                        alt={img.alt || 'Image'}
                        className="w-16 h-16 object-cover rounded-lg"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50%" x="50%" dominant-baseline="middle" text-anchor="middle" font-size="20">🖼️</text></svg>';
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white truncate font-mono text-sm">{img.url}</p>
                        {img.alt && <p className="text-gray-400 text-sm truncate">{img.alt}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {img.width && <span className="text-xs text-gray-400">{img.width}x{img.height}</span>}
                        <span className={`px-2 py-1 rounded text-xs ${getSourceColor(img.source)}`}>{img.source}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filteredAndSortedImages().length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-4xl mb-2">🖼️</p>
                  <p>No images found with the current filter</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Image Modal */}
        {selectedImage && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedImage(null)}
          >
            <div
              className="bg-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <img
                  src={selectedImage.url}
                  alt={selectedImage.alt || 'Image'}
                  className="w-full max-h-96 object-contain bg-black"
                />
                <button
                  onClick={() => setSelectedImage(null)}
                  className="absolute top-4 right-4 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Image Details</h3>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-400 w-24 shrink-0">URL:</span>
                      <code className="text-green-400 text-sm break-all">{selectedImage.url}</code>
                    </div>
                    {selectedImage.alt && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Alt Text:</span>
                        <span className="text-white">{selectedImage.alt}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Source:</span>
                      <span className={`px-2 py-1 rounded text-xs ${getSourceColor(selectedImage.source)}`}>
                        {selectedImage.source}
                      </span>
                    </div>
                    {selectedImage.width && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Dimensions:</span>
                        <span className="text-white">{selectedImage.width} x {selectedImage.height}</span>
                      </div>
                    )}
                    {selectedImage.loading && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Loading:</span>
                        <span className="text-white">{selectedImage.loading}</span>
                      </div>
                    )}
                    {selectedImage.decoding && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Decoding:</span>
                        <span className="text-white">{selectedImage.decoding}</span>
                      </div>
                    )}
                    {selectedImage.type && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Type:</span>
                        <span className="text-white">{selectedImage.type}</span>
                      </div>
                    )}
                    {selectedImage.media && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Media:</span>
                        <span className="text-white text-sm">{selectedImage.media}</span>
                      </div>
                    )}
                    {selectedImage.caption && (
                      <div className="flex items-start gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Caption:</span>
                        <span className="text-white">{selectedImage.caption}</span>
                      </div>
                    )}
                    {selectedImage.parent && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-24 shrink-0">Parent Tag:</span>
                        <span className="text-white">&lt;{selectedImage.parent}&gt;</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 pt-4 border-t border-white/10">
                  <button
                    onClick={() => copyToClipboard(selectedImage.url)}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                  >
                    📋 Copy URL
                  </button>
                  <a
                    href={selectedImage.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                  >
                    🔗 Open Image
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

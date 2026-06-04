import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractMainArticleContent, checkWebsiteChange, checkWebsiteChangeWithDiff } from '../src/main/services/website-change-detector';
import { fetchPageHtml } from '../src/main/services/fetch-pipeline';

// Mock the fetchPageHtml function
vi.mock('../src/main/services/fetch-pipeline', () => ({
  fetchPageHtml: vi.fn(),
}));

// Mock the database to prevent loading better-sqlite3 during tests
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockPrepare = vi.fn().mockReturnValue({
  get: mockGet,
  run: mockRun,
});

vi.mock('../src/main/db/database', () => ({
  getDb: () => ({
    prepare: mockPrepare,
  }),
}));

describe('Zero-Config Website Extractor Heuristics', () => {
  it('should extract main article body and ignore headers, footers, and sidebars', () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Mock News Title</title>
          <style>body { font-family: sans-serif; }</style>
        </head>
        <body>
          <header class="header">
            <h1>My Awesome News Site</h1>
            <nav class="menu">
              <ul>
                <li><a href="/">Home</a></li>
                <li><a href="/about">About</a></li>
              </ul>
            </nav>
          </header>
          
          <div class="container">
            <aside class="sidebar" id="sidebar">
              <h3>Latest Reviews</h3>
              <p>Review 1: Great widget!</p>
              <p>Review 2: Super bad!</p>
            </aside>
            
            <main class="content">
              <article class="post">
                <header class="post-header">
                  <h2>Breaking: Node.js 26 Released</h2>
                  <p class="meta">Published on June 4, 2026</p>
                </header>
                <div class="entry-content">
                  <p>Node.js 26 has been officially released with massive performance boosts in HTTP parsing.</p>
                  <p>This new release includes TLS fingerprinting configuration options directly in HTTP agents.</p>
                  <p>Developers are highly encouraged to upgrade their systems as soon as possible.</p>
                </div>
              </article>
            </main>
          </div>
          
          <footer class="footer">
            <p>Copyright 2026. All rights reserved.</p>
          </footer>
        </body>
      </html>
    `;

    const extractedText = extractMainArticleContent(mockHtml);

    // Should contain the main article body text
    expect(extractedText).toContain('Node.js 26 has been officially released');
    expect(extractedText).toContain('TLS fingerprinting configuration options');
    
    // Should NOT contain elements from the header, nav, footer, or sidebar
    expect(extractedText).not.toContain('My Awesome News Site');
    expect(extractedText).not.toContain('Latest Reviews');
    expect(extractedText).not.toContain('Copyright 2026');
  });
});

describe('Website Change Detection Integration via fetchPageHtml', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully detect changes on website monitors using fetchPageHtml', async () => {
    // 1. Initial run: mock fetchPageHtml to return HTML and mock DB to return no previous hash
    vi.mocked(fetchPageHtml).mockResolvedValue({
      ok: true,
      html: '<html><body><main><p>First version content</p></main></body></html>',
      method: 'http',
      status: 200,
      bytes: 100
    });
    mockGet.mockReturnValueOnce(undefined); // No previous hash

    const result1 = await checkWebsiteChange(1, { url: 'https://example.com', forceBrowser: false });
    expect(result1.changed).toBe(false);
    expect(result1.snippet).toContain('First version content');

    // 2. Second run: return the same hash
    vi.mocked(fetchPageHtml).mockResolvedValue({
      ok: true,
      html: '<html><body><main><p>First version content</p></main></body></html>',
      method: 'http',
      status: 200,
      bytes: 100
    });
    // Return the same hash
    const expectedHash = result1.hash;
    mockGet.mockReturnValueOnce({ last_content_hash: expectedHash });

    const result2 = await checkWebsiteChange(1, { url: 'https://example.com', forceBrowser: false });
    expect(result2.changed).toBe(false);

    // 3. Third run: changed HTML content
    vi.mocked(fetchPageHtml).mockResolvedValue({
      ok: true,
      html: '<html><body><main><p>Second version content - completely new news update</p></main></body></html>',
      method: 'http',
      status: 200,
      bytes: 120
    });
    mockGet.mockReturnValueOnce({ last_content_hash: expectedHash });

    const result3 = await checkWebsiteChange(1, { url: 'https://example.com', forceBrowser: false });
    expect(result3.changed).toBe(true);
    expect(result3.snippet).toContain('Second version content');
  });

  it('should generate a structured visual diff JSON when using checkWebsiteChangeWithDiff', async () => {
    // 1. Initial run: mock fetchPageHtml and mock DB to return no previous hash
    vi.mocked(fetchPageHtml).mockResolvedValue({
      ok: true,
      html: '<html><body><main><p>Original website content line 1\nOriginal website content line 2</p></main></body></html>',
      method: 'http',
      status: 200,
      bytes: 100
    });
    mockGet.mockReturnValue(undefined); // No previous hash or baseline text

    const result1 = await checkWebsiteChangeWithDiff(1, { url: 'https://example.com', forceBrowser: false });
    expect(result1.changed).toBe(false);

    // 2. Mock DB to return previous hash and the previous baseline text
    mockGet
      .mockReturnValueOnce({ last_content_hash: result1.hash }) // for getStoredHash
      .mockReturnValueOnce({ last_content_text: 'Original website content line 1\nOriginal website content line 2' }); // for getStoredBaselineText

    // Mock fetchPageHtml with changed HTML content
    vi.mocked(fetchPageHtml).mockResolvedValue({
      ok: true,
      html: '<html><body><main><p>Original website content line 1\nChanged website content line 2\nAdded new content line 3</p></main></body></html>',
      method: 'http',
      status: 200,
      bytes: 150
    });

    const result2 = await checkWebsiteChangeWithDiff(1, { url: 'https://example.com', forceBrowser: false });
    expect(result2.changed).toBe(true);
    
    // The diff should be a valid JSON string containing oldText and newText
    const parsedDiff = JSON.parse(result2.diff);
    expect(parsedDiff.oldText).toContain('Original website content line 2');
    expect(parsedDiff.newText).toContain('Changed website content line 2');
    expect(parsedDiff.newText).toContain('Added new content line 3');
  });
});



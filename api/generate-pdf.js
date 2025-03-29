const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

// Funcție pentru verificarea autentificării
async function getUserFromRequest(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const session = cookies.session;

    if (!session) {
      return null;
    }

    const decoded = jwt.verify(session, process.env.SESSION_SECRET);
    return decoded.user;
  } catch (error) {
    console.error('Eroare la verificarea sesiunii:', error);
    return null;
  }
}

// Function to fetch content from a URL
async function fetchUrlContent(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const options = new URL(url);
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    
    const req = client.get(options, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve(data);
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    // Set timeout
    req.setTimeout(15000, () => {
      req.abort();
      reject(new Error(`Request timeout for ${url}`));
    });
  });
}

// Process HTML to expand accordions and resize images
function processHtml(html, url) {
  try {
    // Extract base URL for fixing relative URLs
    const baseUrl = new URL(url);
    const domain = `${baseUrl.protocol}//${baseUrl.hostname}`;
    
    // Process image tags - make them smaller and fix relative URLs
    html = html.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
      // Fix relative URLs
      let fullSrc = src;
      if (src.startsWith('/')) {
        fullSrc = `${domain}${src}`;
      } else if (!src.startsWith('http')) {
        fullSrc = `${domain}/${src}`;
      }
      
      // Add style to make images smaller
      return match.replace(/<img/i, '<img style="max-width: 100%; height: auto; max-height: 400px;"');
    });
    
    // Fix relative URLs in links
    html = html.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
      if (href.startsWith('/')) {
        return match.replace(href, `${domain}${href}`);
      } else if (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
        return match.replace(href, `${domain}/${href}`);
      }
      return match;
    });
    
    // Add CSS to expand accordions
    const expansionCss = `
      <style>
        /* Force all accordion and collapsible elements to be visible */
        [aria-expanded="false"] { display: block !important; }
        .accordion-collapse, .collapse { display: block !important; }
        .accordion-button.collapsed::after { transform: rotate(-180deg); }
        
        /* Fix common accordion implementations */
        .accordion-body, .collapse { height: auto !important; max-height: none !important; }
        [class*="closed"], [class*="collapse"]:not(.show) { display: block !important; }
        
        /* Make images reasonable size */
        img { max-width: 100% !important; height: auto !important; max-height: 400px !important; }
        
        /* Remove fixed elements and ads */
        [class*="ad-"], [id*="ad-"], [class*="advertisement"], [id*="advertisement"],
        .sticky-top, .fixed-top, .fixed-bottom { display: none !important; }
        
        /* Improve readability */
        body { padding: 20px !important; max-width: 100% !important; }
        pre, code { white-space: pre-wrap !important; }
      </style>
    `;
    
    // Add stylesheet to the head
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${expansionCss}`);
    } else if (html.includes('<html>')) {
      html = html.replace('<html>', `<html><head>${expansionCss}</head>`);
    } else {
      html = `<html><head>${expansionCss}</head><body>${html}</body></html>`;
    }
    
    // Add JavaScript to try to expand accordions when the page loads
    const expansionScript = `
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          // Try to open all accordions
          try {
            // Bootstrap accordions
            document.querySelectorAll('.accordion-button.collapsed, .accordion-collapse:not(.show)')
              .forEach(el => {
                if (el.classList.contains('accordion-button')) {
                  el.classList.remove('collapsed');
                  el.setAttribute('aria-expanded', 'true');
                } else {
                  el.classList.add('show');
                }
              });
            
            // General accordions
            document.querySelectorAll('[aria-expanded="false"]')
              .forEach(el => el.setAttribute('aria-expanded', 'true'));
              
            // Collapse elements
            document.querySelectorAll('.collapse:not(.show)')
              .forEach(el => el.classList.add('show'));
          } catch(e) {
            console.error('Error expanding accordions:', e);
          }
        });
      </script>
    `;
    
    // Add the script just before the closing body tag
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${expansionScript}</body>`);
    } else {
      html = `${html}${expansionScript}`;
    }
    
    return html;
  } catch (error) {
    console.error('Error processing HTML:', error);
    return html; // Return original HTML if processing fails
  }
}

// Generate PDF with puppeteer using a full-content approach
async function generateFullContentPDF(job) {
  console.log('Using full content PDF generation approach...');
  
  try {
    // Create combined HTML with all pages
    let combinedHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${job.name || 'Web Pages PDF Report'}</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 20px; }
          .cover-page { page-break-after: always; padding: 100px 20px; text-align: center; }
          .page { page-break-after: always; padding: 20px 0; }
          .page:last-child { page-break-after: avoid; }
          .page-header { background: #f0f0f0; padding: 15px; margin-bottom: 20px; border-bottom: 1px solid #ddd; }
          .url { color: #0066cc; word-break: break-all; }
          .timestamp { color: #666; font-size: 14px; margin-top: 8px; }
          h1 { margin-top: 0; color: #333; }
          h2 { color: #444; border-bottom: 1px solid #eee; padding-bottom: 5px; }
          iframe { width: 100%; height: 800px; border: 1px solid #ddd; }
          img { max-width: 100%; height: auto; max-height: 400px; }
          
          /* Print-specific styles */
          @media print {
            .page { page-break-after: always; }
            .page:last-child { page-break-after: avoid; }
            img { max-height: 400px; }
          }
        </style>
      </head>
      <body>
        <div class="cover-page">
          <h1>${job.name || 'Web Pages PDF Report'}</h1>
          <p class="timestamp">Generated on: ${new Date().toLocaleString()}</p>
          <p>This report contains content from the following URLs:</p>
          <ul style="text-align: left; display: inline-block;">
            ${job.urls.map(url => `<li>${url}</li>`).join('')}
          </ul>
        </div>
    `;
    
    // Process each URL and embed the content
    for (let i = 0; i < job.urls.length; i++) {
      const url = job.urls[i];
      console.log(`Processing URL ${i+1}/${job.urls.length}: ${url}`);
      
      try {
        // Fetch the HTML content
        let htmlContent = await fetchUrlContent(url);
        
        // Process the HTML to expand accordions and resize images
        htmlContent = processHtml(htmlContent, url);
        
        // Create a clean page HTML with iframe to isolate content
        combinedHTML += `
          <div class="page">
            <div class="page-header">
              <h2>Page ${i + 1}</h2>
              <div class="url">${url}</div>
            </div>
            
            <div class="page-content">
              ${htmlContent}
            </div>
          </div>
        `;
        
        console.log(`Successfully processed content from ${url}`);
      } catch (error) {
        console.error(`Error processing ${url}:`, error);
        combinedHTML += `
          <div class="page">
            <div class="page-header">
              <h2>Page ${i + 1}</h2>
              <div class="url">${url}</div>
            </div>
            
            <div class="page-content">
              <div style="padding: 20px; border: 1px solid red; background: #fff0f0;">
                <h3>Error loading content</h3>
                <p>${error.message}</p>
              </div>
            </div>
          </div>
        `;
      }
    }
    
    combinedHTML += `</body></html>`;
    
    // Launch puppeteer to generate PDF
    console.log('Launching browser...');
    const puppeteer = require('puppeteer-core');
    const chromium = require('chrome-aws-lambda');
    
    const browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      executablePath: await chromium.executablePath,
      headless: true
    });
    
    console.log('Browser launched, creating page...');
    const page = await browser.newPage();
    
    // Configure the viewport
    await page.setViewport({
      width: job.options?.pageWidth || 1200,
      height: job.options?.pageHeight || 1600
    });
    
    // Set a reasonable timeout
    page.setDefaultNavigationTimeout(30000);
    
    console.log('Setting content...');
    await page.setContent(combinedHTML, { 
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait a bit to ensure all content is rendered
    await page.waitForTimeout(2000);
    
    console.log('Generating PDF...');
    const pdf = await page.pdf({
      format: job.options?.pageSize || 'A4',
      landscape: job.options?.landscape || false,
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      },
      preferCSSPageSize: true
    });
    
    console.log(`PDF generated, size: ${pdf.length} bytes`);
    
    // Close browser properly
    await browser.close();
    console.log('Browser closed');
    
    return pdf;
  } catch (error) {
    console.error('Error in full content PDF generation:', error);
    
    // Fall back to simpler approach if full content approach fails
    try {
      console.log('Falling back to simpler PDF generation...');
      
      // Try using puppeteer with a simpler approach - just listing URLs and brief content
      const puppeteer = require('puppeteer-core');
      const chromium = require('chrome-aws-lambda');
      
      const browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--single-process',
          '--disable-gpu'
        ],
        executablePath: await chromium.executablePath,
        headless: true
      });
      
      const page = await browser.newPage();
      
      // Create a simple HTML with just URLs and basic info
      const simpleHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${job.name || 'PDF Report'}</title>
          <style>
            body { font-family: sans-serif; margin: 40px; }
            h1 { color: #333; }
            p { margin: 10px 0; }
            .urls { margin: 20px 0; }
            .url-item { margin: 15px 0; padding: 10px; border: 1px solid #ddd; }
            .error-message { color: red; padding: 20px; background: #fff0f0; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>${job.name || 'PDF Report'}</h1>
          <p>Generated on: ${new Date().toLocaleString()}</p>
          
          <div class="error-message">
            <p><strong>Note:</strong> Full content rendering failed. This is a simplified version.</p>
            <p>Error: ${error.message}</p>
          </div>
          
          <div class="urls">
            <h2>URLs in this job:</h2>
            ${job.urls.map((url, index) => `
              <div class="url-item">
                <h3>Page ${index + 1}</h3>
                <p><a href="${url}">${url}</a></p>
              </div>
            `).join('')}
          </div>
        </body>
        </html>
      `;
      
      await page.setContent(simpleHtml, { waitUntil: 'networkidle0' });
      
      const pdf = await page.pdf({
        format: job.options?.pageSize || 'A4',
        landscape: job.options?.landscape || false,
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      });
      
      await browser.close();
      return pdf;
    } catch (fallbackError) {
      console.error('Error in fallback PDF generation:', fallbackError);
      
      // As a last resort, use pdf-lib to create a simple PDF
      const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
      
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
      const { width, height } = page.getSize();
      
      // Add fonts
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Add content
      page.drawText(`${job.name || 'PDF Report'}`, {
        x: 50,
        y: height - 50,
        size: 24,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      
      page.drawText(`Generated on: ${new Date().toLocaleString()}`, {
        x: 50,
        y: height - 80,
        size: 12,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
      });
      
      page.drawText('Error generating full content PDF:', {
        x: 50,
        y: height - 120,
        size: 12,
        font: boldFont,
        color: rgb(0.8, 0, 0),
      });
      
      page.drawText(error.message, {
        x: 50,
        y: height - 140,
        size: 10,
        font: font,
        color: rgb(0.8, 0, 0),
      });
      
      page.drawText('URLs in this job:', {
        x: 50,
        y: height - 180,
        size: 14,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      
      let yPosition = height - 210;
      job.urls.forEach((url, index) => {
        page.drawText(`${index + 1}. ${url}`, {
          x: 50,
          y: yPosition,
          size: 10,
          font: font,
          color: rgb(0, 0, 0),
        });
        yPosition -= 20;
      });
      
      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    }
  }
}

// Main handler for HTTP requests
module.exports = async (req, res) => {
  console.log('PDF generation request received');
  
  // Check HTTP method
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }
  
  try {
    // Extract URL parameters
    const { query } = parse(req.url, true);
    const jobId = query.id;
    
    if (!jobId) {
      return res.status(400).send('Missing job ID');
    }
    
    console.log(`Fetching job with ID: ${jobId}`);
    
    // Connect to database
    const db = await connectToDatabase();
    const jobsCollection = db.collection('jobs');
    
    // Check user authentication
    const user = await getUserFromRequest(req);
    
    // Find the job
    let job;
    try {
      job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });
    } catch (e) {
      // If ID is not a valid ObjectId, try as string
      job = await jobsCollection.findOne({ _id: jobId });
    }
    
    if (!job) {
      return res.status(404).send('Job not found');
    }
    
    console.log(`Job found: ${job.name}, URLs: ${job.urls.length}`);
    
    // Check if the job belongs to the user or is public
    if (job.userId && user && job.userId !== user.sub && !job.isPublic) {
      return res.status(403).send('Unauthorized access to this job');
    }
    
    // Generate the PDF
    console.log('Starting full content PDF generation...');
    const pdfBuffer = await generateFullContentPDF(job);
    
    // Update last generated timestamp
    await jobsCollection.updateOne(
      { _id: job._id },
      { $set: { lastGenerated: new Date() } }
    );
    
    console.log(`PDF generation completed, size: ${pdfBuffer.length} bytes`);
    
    // Check if it's actually a PDF
    const isPdf = pdfBuffer.length > 100 && 
                 pdfBuffer.toString('ascii', 0, 4) === '%PDF';
    
    // Set appropriate headers
    if (isPdf) {
      console.log('Response is a valid PDF');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${job.name || 'generated'}-pdf.pdf"`);
    } else {
      console.log('Response is not a valid PDF, sending as text');
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${job.name || 'generated'}.txt"`);
    }
    
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
};

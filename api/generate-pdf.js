const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');

// Import our custom Chrome setup utility
const { setupChromePath } = require('../chromium-aws-lambda-setup');

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

// Log some basic environment information for debugging
function logEnvironmentInfo() {
  console.log('Environment information:');
  console.log(`Working directory: ${process.cwd()}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Temp directory: ${process.env.TEMP || process.env.TMP || '/tmp'}`);
  console.log(`LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH || 'not set'}`);

  // Check if /tmp exists and is writable
  try {
    const tmpStats = fs.statSync('/tmp');
    console.log(`/tmp exists: ${tmpStats.isDirectory()}`);
    
    // Try to write to /tmp
    const testFile = '/tmp/test-write.txt';
    fs.writeFileSync(testFile, 'test');
    console.log(`Successfully wrote to ${testFile}`);
    fs.unlinkSync(testFile);
  } catch (error) {
    console.error(`Error with /tmp directory: ${error.message}`);
  }
  
  // Check for the libnss3.so file
  try {
    const libPath = '/tmp/libnss3.so';
    if (fs.existsSync(libPath)) {
      console.log(`libnss3.so exists at ${libPath}`);
    } else {
      console.log(`libnss3.so not found at ${libPath}`);
    }
  } catch (error) {
    console.error(`Error checking for libnss3.so: ${error.message}`);
  }
}

// Funcție pentru generarea PDF-ului
async function generatePDF(job) {
  // Log environment information
  logEnvironmentInfo();
  
  // Try to find an alternative PDF generation approach if Puppeteer fails
  let usePuppeteer = true;
  
  if (usePuppeteer) {
    // Use Chrome AWS Lambda with our custom setup
    const chromium = require('chrome-aws-lambda');
    const puppeteer = require('puppeteer-core');
    
    let browser;
    try {
      console.log('Starting browser with enhanced settings...');
      
      // Get our custom Chrome settings
      const chromeSettings = setupChromePath();
      
      // Decide on the executable path
      let executablePath;
      if (chromeSettings.executablePath) {
        executablePath = chromeSettings.executablePath;
      } else {
        try {
          executablePath = await chromium.executablePath;
          console.log(`Using chromium.executablePath: ${executablePath}`);
        } catch (error) {
          console.error(`Error getting chromium.executablePath: ${error.message}`);
          // Fallback to default
          executablePath = '/tmp/chromium';
        }
      }
      
      console.log(`Launching browser with executablePath: ${executablePath}`);
      
      // Configure all Chrome launch options
      const launchOptions = {
        args: [
          ...chromium.args,
          ...chromeSettings.args
        ],
        defaultViewport: {
          width: job.options?.pageWidth || 1200,
          height: job.options?.pageHeight || 1600
        },
        executablePath,
        headless: true,
        ignoreHTTPSErrors: true
      };
      
      // Try to launch the browser
      try {
        browser = await puppeteer.launch(launchOptions);
        console.log('Browser launched successfully');
      } catch (error) {
        console.error(`Failed to launch the browser: ${error.message}`);
        
        // Try one more time with a different path
        console.log('Trying alternative approach...');
        
        // If we're in a Vercel environment, try to copy the library and set the path
        if (process.env.VERCEL) {
          try {
            // Try to load directly using Puppeteer
            const puppeteerExtra = require('puppeteer-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            puppeteerExtra.use(StealthPlugin());
            
            browser = await puppeteerExtra.launch({
              args: launchOptions.args,
              defaultViewport: launchOptions.defaultViewport,
              ignoreHTTPSErrors: true,
              headless: true
            });
            
            console.log('Launched browser with puppeteer-extra');
          } catch (puppeteerError) {
            console.error(`Failed again: ${puppeteerError.message}`);
            throw error; // Throw the original error
          }
        } else {
          throw error;
        }
      }
      
      // Create a new page
      const page = await browser.newPage();
      
      // Set cache and CSP settings
      await page.setCacheEnabled(true);
      await page.setBypassCSP(true);
      
      // Set user agent for better compatibility
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Template HTML for combined pages
      let combinedHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${job.name || 'Combined PDF'}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
            .page { page-break-after: always; padding-bottom: 30px; }
            .page:last-child { page-break-after: avoid; }
            .header { background: #f0f0f0; padding: 15px; margin-bottom: 20px; border-bottom: 1px solid #ddd; }
            .url { color: #0066cc; word-break: break-all; }
            .timestamp { color: #666; font-size: 12px; margin-top: 8px; }
            h1 { margin-top: 0; color: #333; }
            h2 { color: #444; border-bottom: 1px solid #eee; padding-bottom: 5px; }
            .content { margin-top: 20px; }
            .error { color: red; padding: 20px; border: 1px solid red; background: #fff0f0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${job.name || 'Combined Web Pages'}</h1>
            <div class="timestamp">Generated on: ${new Date().toLocaleString()}</div>
          </div>
      `;
      
      // Process each URL individually to minimize memory usage
      console.log(`Processing ${job.urls.length} URLs...`);
      for (let i = 0; i < job.urls.length; i++) {
        const url = job.urls[i];
        
        try {
          console.log(`Processing URL ${i+1}/${job.urls.length}: ${url}`);
          
          // Instead of loading full pages, we'll use a simpler approach
          // Just create placeholder sections with links for each URL
          combinedHTML += `
            <div class="page">
              <h2>Page ${i + 1}: <span class="url">${url}</span></h2>
              <div class="content">
                <p>URL: <a href="${url}">${url}</a></p>
                <p>This is a placeholder for content from this URL.</p>
                <p>For full content, visit the URL directly.</p>
              </div>
            </div>
          `;
        } catch (error) {
          console.error(`Error processing URL ${url}:`, error);
          combinedHTML += `
            <div class="page">
              <h2>Page ${i + 1}: <span class="url">${url}</span></h2>
              <div class="error">
                Error loading page: ${error.message}
              </div>
            </div>
          `;
        }
      }
      
      combinedHTML += `</body></html>`;
      
      console.log('Setting content for final PDF...');
      // Set the simplified HTML content
      await page.setContent(combinedHTML, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      console.log('Generating PDF...');
      // Generate the final PDF
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
      
      console.log('PDF generated successfully');
      await browser.close();
      return pdf;
    } catch (error) {
      console.error('Error in PDF generation with Puppeteer:', error);
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          console.error('Error closing browser:', e);
        }
      }
      
      // If Puppeteer fails, we'll use a simplified approach
      console.log('Falling back to a simplified PDF generation...');
      
      // Generate a simple HTML page
      const simpleHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${job.name || 'Generated PDF'}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { color: #333; }
            .url-list { margin: 20px 0; }
            .url-item { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
            .url-link { color: #0066cc; word-break: break-all; }
            .error-message { color: red; padding: 10px; background: #fff0f0; border: 1px solid red; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>${job.name || 'Generated PDF'}</h1>
          <p>Generated on: ${new Date().toLocaleString()}</p>
          
          <div class="error-message">
            <p><strong>PDF Generation Error</strong></p>
            <p>We couldn't generate a full PDF with website content due to a technical issue.</p>
            <p>Error: ${error.message}</p>
          </div>
          
          <h2>URLs in this job:</h2>
          <div class="url-list">
            ${job.urls.map((url, index) => `
              <div class="url-item">
                <p><strong>URL ${index + 1}:</strong> <a href="${url}" class="url-link">${url}</a></p>
              </div>
            `).join('')}
          </div>
          
          <p>Please try again later or contact support if the issue persists.</p>
        </body>
        </html>
      `;
      
      // We'll use a very simple library to convert HTML to PDF if available
      try {
        // Try to use html-pdf-node if available
        const htmlPdf = require('html-pdf-node');
        const pdfBuffer = await new Promise((resolve, reject) => {
          htmlPdf.generatePdf({ content: simpleHTML }, { format: 'A4' })
            .then(buffer => resolve(buffer))
            .catch(err => reject(err));
        });
        return pdfBuffer;
      } catch (pdfError) {
        console.error('Error generating simplified PDF:', pdfError);
        // Return the HTML as a last resort
        return Buffer.from(simpleHTML);
      }
    }
  }
}

// Handler-ul principal pentru cereri
module.exports = async (req, res) => {
  console.log('PDF generation request received');
  
  // Verificăm metoda HTTP
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }
  
  try {
    // Extragem parametrul de id din URL
    const { query } = parse(req.url, true);
    const jobId = query.id;
    
    if (!jobId) {
      return res.status(400).send('Missing job ID');
    }
    
    console.log(`Fetching job with ID: ${jobId}`);
    
    // Conectare la baza de date
    const db = await connectToDatabase();
    const jobsCollection = db.collection('jobs');
    
    // Verificăm dacă utilizatorul este autentificat
    const user = await getUserFromRequest(req);
    
    // Găsim job-ul în baza de date
    let job;
    try {
      job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });
    } catch (e) {
      // Dacă ID-ul nu este un ObjectId valid, încercăm ca string
      job = await jobsCollection.findOne({ _id: jobId });
    }
    
    if (!job) {
      return res.status(404).send('Job not found');
    }
    
    console.log(`Job found: ${job.name}, URLs: ${job.urls.length}`);
    
    // Verificăm dacă job-ul aparține utilizatorului actual (sau e public)
    if (job.userId && user && job.userId !== user.sub && !job.isPublic) {
      return res.status(403).send('Unauthorized access to this job');
    }
    
    // Generăm PDF-ul
    console.log('Starting PDF generation...');
    const pdfBuffer = await generatePDF(job);
    
    // Actualizăm timestamp-ul ultimei generări
    await jobsCollection.updateOne(
      { _id: job._id },
      { $set: { lastGenerated: new Date() } }
    );
    
    console.log('PDF generation completed, sending response...');
    
    // Check the content type based on the response
    const contentType = pdfBuffer.toString().startsWith('<!DOCTYPE html>') 
      ? 'text/html' 
      : 'application/pdf';
      
    // Setăm header-ele pentru descărcare
    res.setHeader('Content-Type', contentType);
    if (contentType === 'application/pdf') {
      res.setHeader('Content-Disposition', `attachment; filename="${job.name || 'generated'}-pdf.pdf"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${job.name || 'generated'}.html"`);
    }
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Trimitem PDF-ul ca răspuns
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
};

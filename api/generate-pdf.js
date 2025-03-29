const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const https = require('https');

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

// Funcție pentru a face cereri HTTP cu logging extins
async function makeRequest(url, options, data) {
  console.log(`Making request to: ${url}`);
  console.log(`Request method: ${options.method}`);
  console.log(`Request headers:`, options.headers);
  
  // Log a truncated version of the data for debugging
  if (data) {
    const dataStr = data.toString();
    console.log(`Request data (truncated): ${dataStr.substring(0, 200)}... (${dataStr.length} bytes total)`);
  }
  
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      console.log(`Response status code: ${res.statusCode}`);
      console.log(`Response headers:`, res.headers);
      
      const chunks = [];
      let size = 0;
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
        console.log(`Received chunk of ${chunk.length} bytes, total so far: ${size} bytes`);
      });
      
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        console.log(`Request complete, total size: ${body.length} bytes`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          let errorBody = "";
          try {
            errorBody = body.toString('utf8');
            // If it looks like JSON, try to parse it
            if (errorBody.startsWith('{') || errorBody.startsWith('[')) {
              const jsonError = JSON.parse(errorBody);
              errorBody = JSON.stringify(jsonError, null, 2);
            }
          } catch (e) {
            errorBody = `[Could not parse error body: ${e.message}]`;
          }
          
          console.error(`Request failed with status ${res.statusCode}. Error body:`, errorBody);
          reject(new Error(`HTTP request failed with status ${res.statusCode}: ${errorBody}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`Request error:`, error);
      reject(error);
    });

    if (data) {
      req.write(data);
    }
    req.end();
    
    // Add a timeout
    req.setTimeout(60000, () => {
      console.error('Request timed out after 60 seconds');
      req.destroy(new Error('Request timeout after 60 seconds'));
    });
  });
}

// Generate CSS to expand accordions and resize images
function getCustomCSS() {
  return `
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
    body { padding: 20px !important; max-width: 100% !important; overflow-x: hidden !important; }
    pre, code { white-space: pre-wrap !important; }
    
    /* Print-specific styles */
    @media print {
      .page { page-break-after: always; }
      .page:last-child { page-break-after: avoid; }
      img { max-height: 400px; }
    }
  `;
}

// Generate JavaScript to expand accordions
function getCustomJS() {
  return `
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
  `;
}

// Function to generate a PDF using Browserless.io API
async function generatePDFWithBrowserless(job) {
  try {
    console.log('Generating PDF using Browserless.io...');
    
    // Check for API key
    const browserlessApiKey = process.env.BROWSERLESS_API_KEY;
    if (!browserlessApiKey) {
      console.error('Browserless API key is not configured');
      throw new Error('Browserless API key is not configured. Please set BROWSERLESS_API_KEY in your environment variables.');
    }
    
    // Log first few characters of API key for verification (security-safe)
    const keyLength = browserlessApiKey.length;
    const maskedKey = browserlessApiKey.substring(0, 4) + 
                     '*'.repeat(Math.max(0, keyLength - 8)) + 
                     (keyLength > 4 ? browserlessApiKey.substring(keyLength - 4) : '');
    console.log(`Using Browserless API key: ${maskedKey} (length: ${keyLength})`);
    
    // Try a single URL first as a test
    const testUrl = job.urls[0];
    console.log(`Testing Browserless with first URL: ${testUrl}`);
    
    const options = {
      method: 'POST',
      hostname: 'chrome.browserless.io',
      path: `/pdf?token=${browserlessApiKey}`,
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json'
      }
    };
    
    const requestBody = JSON.stringify({
      url: testUrl,
      options: {
        printBackground: true,
        format: job.options?.pageSize || 'A4',
        landscape: job.options?.landscape || false,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        },
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width: 100%; font-size: 10px; text-align: center; color: #666;">
            <span>${job.name || 'PDF Report'}</span>
          </div>
        `,
        footerTemplate: `
          <div style="width: 100%; font-size: 10px; text-align: center; color: #666;">
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>
        `
      },
      gotoOptions: {
        waitUntil: 'networkidle2',
        timeout: 30000
      },
      additionalJS: getCustomJS(),
      additionalCSS: getCustomCSS()
    });
    
    try {
      console.log('Sending test request to Browserless.io...');
      const pdfBuffer = await makeRequest(
        `https://chrome.browserless.io/pdf?token=${browserlessApiKey}`,
        options,
        requestBody
      );
      
      console.log(`Successfully generated test PDF, size: ${pdfBuffer.length} bytes`);
      
      // If test succeeds, return it as the result (for now, just to verify API connection)
      return pdfBuffer;
      
    } catch (error) {
      console.error(`Error generating test PDF:`, error);
      throw new Error(`Browserless API test failed: ${error.message}`);
    }
    
    // Note: The full implementation with multiple URLs is commented out for now
    // Until we get the basic API connection working
    /*
    // Create a single PDF for each URL, then combine them
    const pdfPromises = job.urls.map(async (url, index) => {
      console.log(`Processing URL ${index+1}/${job.urls.length}: ${url}`);
      
      const options = {
        method: 'POST',
        hostname: 'chrome.browserless.io',
        path: `/pdf?token=${browserlessApiKey}`,
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json'
        }
      };
      
      const requestBody = JSON.stringify({
        url: url,
        options: {
          printBackground: true,
          format: job.options?.pageSize || 'A4',
          landscape: job.options?.landscape || false,
          margin: {
            top: '20px',
            right: '20px',
            bottom: '20px',
            left: '20px'
          },
          displayHeaderFooter: true,
          headerTemplate: `
            <div style="width: 100%; font-size: 10px; text-align: center; color: #666;">
              <span>${job.name || 'PDF Report'}</span>
            </div>
          `,
          footerTemplate: `
            <div style="width: 100%; font-size: 10px; text-align: center; color: #666;">
              <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
            </div>
          `
        },
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000
        },
        additionalJS: getCustomJS(),
        additionalCSS: getCustomCSS()
      });
      
      try {
        const pdfBuffer = await makeRequest(
          `https://chrome.browserless.io/pdf?token=${browserlessApiKey}`,
          options,
          requestBody
        );
        
        console.log(`Successfully generated PDF for ${url}, size: ${pdfBuffer.length} bytes`);
        return {
          url,
          pdfBuffer,
          success: true
        };
      } catch (error) {
        console.error(`Error generating PDF for ${url}:`, error);
        return {
          url,
          error: error.message,
          success: false
        };
      }
    });
    
    // Wait for all PDFs to be generated
    const results = await Promise.all(pdfPromises);
    
    // Return the first successful PDF if we couldn't generate all of them
    const successfulResults = results.filter(result => result.success);
    
    if (successfulResults.length === 0) {
      throw new Error('Could not generate any PDFs. Check the Browserless.io API key and URLs.');
    }
    
    // For now, just return the first PDF
    return successfulResults[0].pdfBuffer;
    */
    
  } catch (error) {
    console.error('Error in Browserless PDF generation:', error);
    throw error;
  }
}

// Handler-ul principal pentru cereri
module.exports = async (req, res) => {
  console.log('PDF generation request received');
  
  // Log all environment variables (with secret values masked)
  console.log('Environment variables:');
  Object.keys(process.env).forEach(key => {
    const value = process.env[key];
    if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')) {
      // Mask secrets
      const maskedValue = value ? 
        value.substring(0, 3) + '***' + (value.length > 6 ? value.substring(value.length - 3) : '') : 
        'null';
      console.log(`${key}: ${maskedValue} (length: ${value ? value.length : 0})`);
    } else {
      // Safe to log non-secret values
      console.log(`${key}: ${value && value.length > 100 ? value.substring(0, 100) + '...' : value}`);
    }
  });
  
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
    console.log(`First URL in job: ${job.urls[0]}`);
    
    // Verificăm dacă job-ul aparține utilizatorului actual (sau e public)
    if (job.userId && user && job.userId !== user.sub && !job.isPublic) {
      return res.status(403).send('Unauthorized access to this job');
    }
    
    // Generăm PDF-ul
    console.log('Starting PDF generation with Browserless.io...');
    const pdfBuffer = await generatePDFWithBrowserless(job);
    
    // Actualizăm timestamp-ul ultimei generări
    await jobsCollection.updateOne(
      { _id: job._id },
      { $set: { lastGenerated: new Date() } }
    );
    
    console.log('PDF generation completed, sending response...');
    
    // Verificăm dacă este un PDF valid
    const isPdf = pdfBuffer.length > 100 && 
                 pdfBuffer.toString('ascii', 0, 4) === '%PDF';
    
    if (!isPdf) {
      console.warn('Warning: Generated content does not appear to be a valid PDF');
      console.log('First 100 bytes of response:', pdfBuffer.toString('ascii', 0, 100));
    }
    
    // Setăm header-ele pentru descărcare
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${job.name || 'generated'}-pdf.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Trimitem PDF-ul ca răspuns
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
};

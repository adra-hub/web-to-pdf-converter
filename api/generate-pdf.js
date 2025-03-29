const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

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

// Funcție pentru generarea PDF-ului
async function generatePDF(job) {
  // Pentru Vercel, folosim chrome-aws-lambda și puppeteer-core
  // fără plugin-ul stealth care cauzează probleme
  const chromium = require('chrome-aws-lambda');
  const puppeteer = require('puppeteer-core');
  
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-features=site-per-process',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: true,
    });

    console.log('Browser launched successfully');

    // Creăm o pagină nouă
    const page = await browser.newPage();
    
    // Setăm viewport-ul în funcție de opțiunile job-ului
    await page.setViewport({ 
      width: job.options?.pageWidth || 1200, 
      height: job.options?.pageHeight || 1600 
    });
    
    // Setăm agent-ul de utilizator pentru compatibilitate mai bună
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Template HTML pentru combinarea paginilor
    let combinedHTML = `
      <!DOCTYPE html>
      <html>
      <head>
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

    // Procesăm fiecare URL din job
    for (let i = 0; i < job.urls.length; i++) {
      const url = job.urls[i];
      
      try {
        console.log(`Processing URL ${i+1}/${job.urls.length}: ${url}`);
        
        // Navigăm la URL cu un timeout mai mare
        await page.goto(url, { 
          waitUntil: 'networkidle2', // Schimbat la networkidle2 pentru a fi mai permisiv
          timeout: 45000  // 45 seconds to accommodate slower sites
        });
        
        // Executăm script pentru a expanda elementele de tip acordeon
        if (job.options?.expandAccordions) {
          await page.evaluate(() => {
            // Încercăm să găsim și să deschidem diverse tipuri de acordeoane
            
            // Bootstrap accordions
            document.querySelectorAll('.accordion-button.collapsed').forEach(button => {
              try { button.click(); } catch (e) {}
            });
            
            // Generic accordions by attribute
            document.querySelectorAll('[aria-expanded="false"]').forEach(elem => {
              try { elem.click(); } catch (e) {}
            });
            
            // Generic accordions by class
            ['accordion', 'collapse', 'dropdown'].forEach(className => {
              document.querySelectorAll(`.${className}`).forEach(acc => {
                if (acc.classList.contains('collapsed') || acc.classList.contains('closed') || 
                    !acc.classList.contains('active') || !acc.classList.contains('show')) {
                  try { acc.click(); } catch (e) {}
                }
              });
            });
            
            // Așteptăm pentru animații
            return new Promise(resolve => setTimeout(resolve, 1000));
          });
          
          // Așteptăm ca toate resursele să se încarce după expandare
          await page.waitForTimeout(1500);
        }
        
        // Obținem conținutul HTML al paginii
        const pageContent = await page.evaluate(() => {
          // Curățăm conținutul de elemente nedorite
          document.querySelectorAll('script, style, iframe[src*="ads"], div[id*="ad-"], div[class*="ad-"]')
            .forEach(el => { try { el.remove(); } catch (e) {} });
          
          // Returnăm conținutul body
          return document.documentElement.outerHTML;
        });
        
        // Adăugăm conținutul la HTML-ul combinat
        combinedHTML += `
          <div class="page">
            <h2>Page ${i + 1}: <span class="url">${url}</span></h2>
            <div class="content">
              ${pageContent}
            </div>
          </div>
        `;
      } catch (error) {
        console.error(`Error processing URL ${url}:`, error);
        // În caz de eroare, adăugăm un mesaj de eroare
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
    // Setăm conținutul HTML combinat
    await page.setContent(combinedHTML, { waitUntil: 'networkidle2' });
    
    console.log('Generating PDF...');
    // Generăm PDF-ul final
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
    
    console.log('PDF generated successfully');
    await browser.close();
    return pdf;
  } catch (error) {
    console.error('Error in PDF generation:', error);
    if (browser) {
      await browser.close();
    }
    throw error;
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
    
    // Setăm header-ele pentru descărcare
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${job.name || 'generated'}-pdf.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Trimitem PDF-ul ca răspuns
    res.status(200).send(pdfBuffer);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
};

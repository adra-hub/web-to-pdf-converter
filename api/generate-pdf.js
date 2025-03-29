// Importăm modulul pentru a procesa cereri HTTP
const { parse } = require('url');

// Folosim Puppeteer Lite din cloud pentru a genera PDF-uri
async function generatePDF(urls) {
  const { chromium } = require('chrome-aws-lambda');
  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: true,
  });

  try {
    // Combinăm toate paginile într-un singur HTML
    const page = await browser.newPage();
    let combinedHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Combined PDF</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
          .page { page-break-after: always; padding-bottom: 30px; }
          .page:last-child { page-break-after: avoid; }
          .header { background: #f0f0f0; padding: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd; }
          .url { color: #0066cc; word-break: break-all; }
          .timestamp { color: #666; font-size: 12px; margin-top: 8px; }
          h1 { margin-top: 0; color: #333; }
          h2 { color: #444; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Combined Web Pages PDF</h1>
          <div class="timestamp">Generated on: ${new Date().toLocaleString()}</div>
        </div>
    `;

    // Adăugăm fiecare pagină web
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Capturăm screenshot-ul paginii
        const screenshot = await page.screenshot({ 
          fullPage: true, 
          type: 'jpeg',
          quality: 80
        });
        
        // Convertim screenshot-ul în base64 pentru a-l include în HTML
        const base64Image = screenshot.toString('base64');
        
        combinedHTML += `
          <div class="page">
            <h2>Page ${i + 1}: <span class="url">${url}</span></h2>
            <img src="data:image/jpeg;base64,${base64Image}" style="width: 100%;" />
          </div>
        `;
      } catch (error) {
        // Dacă avem eroare la o pagină, adăugăm un mesaj de eroare
        combinedHTML += `
          <div class="page">
            <h2>Page ${i + 1}: <span class="url">${url}</span></h2>
            <div style="color: red; padding: 20px; border: 1px solid red; background: #fff0f0;">
              Error loading page: ${error.message}
            </div>
          </div>
        `;
      }
    }
    
    combinedHTML += `</body></html>`;
    
    // Setăm conținutul HTML combinat
    await page.setContent(combinedHTML, { waitUntil: 'networkidle0' });
    
    // Generăm PDF-ul final
    const pdf = await page.pdf({
      format: 'A4',
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
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Handler-ul principal pentru cereri
module.exports = async (req, res) => {
  try {
    // Extragem parametrul de id din URL
    const { query } = parse(req.url, true);
    const jobId = query.id;
    
    if (!jobId) {
      return res.status(400).send('Missing job ID');
    }
    
    // În aplicația reală, am lua jobul din bază de date
    // Aici simulăm că utilizatorul va trimite URL-urile în query
    const urls = query.urls ? query.urls.split(',') : [];
    
    if (urls.length === 0) {
      return res.status(400).send('No URLs provided. Add ?urls=url1,url2,url3 to the query string');
    }
    
    // Generăm PDF-ul
    const pdfBuffer = await generatePDF(urls);
    
    // Setăm header-ele pentru descărcare
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="combined-pdf-${jobId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Trimitem PDF-ul ca răspuns
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
};

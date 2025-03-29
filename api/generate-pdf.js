const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const fs = require('fs');

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

// Generate a minimal PDF using a very basic approach
async function generateMinimalPDF(job) {
  console.log('Using minimal PDF generation approach...');
  
  try {
    // Using puppeteer-core with minimal settings
    const puppeteer = require('puppeteer-core');
    const chromium = require('chrome-aws-lambda');
    
    // Create very minimal HTML
    const html = `
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
        </style>
      </head>
      <body>
        <h1>${job.name || 'PDF Report'}</h1>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        
        <div class="urls">
          <h2>URLs:</h2>
          <ul>
            ${job.urls.map(url => `<li>${url}</li>`).join('')}
          </ul>
        </div>
      </body>
      </html>
    `;
    
    console.log('Launching browser...');
    
    // Launch with minimal options
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
    
    console.log('Setting content...');
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    console.log('Generating PDF...');
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
    
    console.log(`PDF generated, size: ${pdf.length} bytes`);
    
    // Close browser properly
    await browser.close();
    console.log('Browser closed');
    
    return pdf;
  } catch (error) {
    console.error('Error in minimal PDF generation:', error);
    
    // Fallback to a static PDF if everything else fails
    try {
      console.log('Using static PDF as final fallback');
      
      // Create a simple static PDF in memory
      const { PDFDocument, rgb } = require('pdf-lib');
      
      // Create a new PDF document
      const pdfDoc = await PDFDocument.create();
      
      // Add a page to the document
      const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
      
      // Get the width and height of the page
      const { width, height } = page.getSize();
      
      // Draw text on the page
      page.drawText(`${job.name || 'PDF Report'}`, {
        x: 50,
        y: height - 50,
        size: 24,
        color: rgb(0, 0, 0),
      });
      
      page.drawText(`Generated on: ${new Date().toLocaleString()}`, {
        x: 50,
        y: height - 80,
        size: 12,
        color: rgb(0, 0, 0),
      });
      
      page.drawText('URLs:', {
        x: 50,
        y: height - 120,
        size: 14,
        color: rgb(0, 0, 0),
      });
      
      // Add each URL
      let yPosition = height - 150;
      job.urls.forEach((url, index) => {
        page.drawText(`${index + 1}. ${url}`, {
          x: 50,
          y: yPosition,
          size: 10,
          color: rgb(0, 0, 0),
        });
        yPosition -= 20;
      });
      
      // Serialize the PDF to bytes
      const pdfBytes = await pdfDoc.save();
      
      return Buffer.from(pdfBytes);
    } catch (pdfLibError) {
      console.error('Error in static PDF fallback:', pdfLibError);
      
      // As a last resort, return a simple text document
      const text = `
        ${job.name || 'PDF Report'}
        Generated on: ${new Date().toLocaleString()}
        
        URLs:
        ${job.urls.map((url, index) => `${index + 1}. ${url}`).join('\n')}
      `;
      
      return Buffer.from(text);
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
    console.log('Starting simplified PDF generation...');
    const pdfBuffer = await generateMinimalPDF(job);
    
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

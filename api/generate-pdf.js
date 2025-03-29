const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const fs = require('fs');
const https = require('https');
const http = require('http');

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
    
    const req = client.get(url, (res) => {
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

// Function to extract minimal content from HTML
function extractMinimalContent(html, url) {
  try {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : url;
    
    // Extract text content (simplified approach)
    let content = html
      // Remove scripts, styles, and comments
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Extract text from paragraphs and headings
      .match(/<(p|h1|h2|h3|h4|h5|h6)[^>]*>(.*?)<\/(p|h1|h2|h3|h4|h5|h6)>/gi) || [];
    
    content = content.map(tag => {
      // Convert tag to plain text
      return tag
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')  // Convert &nbsp; to spaces
        .replace(/&lt;/g, '<')    // Convert &lt; to <
        .replace(/&gt;/g, '>')    // Convert &gt; to >
        .replace(/&amp;/g, '&')   // Convert &amp; to &
        .replace(/&quot;/g, '"')  // Convert &quot; to "
        .trim();                  // Trim whitespace
    }).filter(text => text.length > 10); // Filter out short snippets
    
    // Limit to a reasonable number of paragraphs to save memory
    const maxParagraphs = 15;
    if (content.length > maxParagraphs) {
      content = content.slice(0, maxParagraphs);
      content.push("... (content truncated for PDF size)");
    }
    
    return { title, content };
  } catch (error) {
    console.error(`Error extracting content from ${url}:`, error);
    return { 
      title: url, 
      content: [`Error extracting content: ${error.message}`] 
    };
  }
}

// Generate PDF with real content
async function generateEnhancedPDF(job) {
  console.log('Using enhanced PDF generation with real content...');
  
  try {
    // Fetch content from each URL
    const pagesContent = [];
    for (let i = 0; i < job.urls.length; i++) {
      const url = job.urls[i];
      console.log(`Fetching content for URL ${i+1}/${job.urls.length}: ${url}`);
      
      try {
        const htmlContent = await fetchUrlContent(url);
        const { title, content } = extractMinimalContent(htmlContent, url);
        
        pagesContent.push({
          url,
          title,
          content
        });
        
        console.log(`Successfully extracted content from ${url}, got ${content.length} paragraphs`);
      } catch (error) {
        console.error(`Error fetching content from ${url}:`, error);
        pagesContent.push({
          url,
          title: url,
          content: [`Error: ${error.message}`]
        });
      }
    }
    
    // Using puppeteer-core with minimal settings
    const puppeteer = require('puppeteer-core');
    const chromium = require('chrome-aws-lambda');
    
    // Create HTML with real content
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${job.name || 'PDF Report'}</title>
        <style>
          body { font-family: sans-serif; margin: 40px; }
          h1 { color: #333; margin-bottom: 10px; }
          h2 { color: #444; margin-top: 30px; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
          h3 { color: #555; }
          p { margin: 10px 0; line-height: 1.4; }
          .page { page-break-after: always; }
          .url { color: #0066cc; word-break: break-all; font-size: 14px; margin-bottom: 15px; }
          .content { margin-top: 20px; }
          .timestamp { color: #666; font-size: 14px; margin-top: 5px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <h1>${job.name || 'Web Pages PDF Report'}</h1>
        <p class="timestamp">Generated on: ${new Date().toLocaleString()}</p>
        
        ${pagesContent.map((page, index) => `
          <div class="page">
            <h2>${index + 1}. ${page.title}</h2>
            <div class="url">Source: ${page.url}</div>
            
            <div class="content">
              ${page.content.map(paragraph => `<p>${paragraph}</p>`).join('')}
            </div>
          </div>
        `).join('')}
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
    
    console.log(`PDF generated, size: ${pdf.length} bytes`);
    
    // Close browser properly
    await browser.close();
    console.log('Browser closed');
    
    return pdf;
  } catch (error) {
    console.error('Error in enhanced PDF generation:', error);
    
    // Fallback to a static PDF if everything else fails
    try {
      console.log('Using static PDF as fallback');
      
      // Create a simple static PDF in memory
      const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
      
      // Create a new PDF document
      const pdfDoc = await PDFDocument.create();
      
      // Add a page to the document
      const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
      
      // Get the width and height of the page
      const { width, height } = page.getSize();
      
      // Add fonts
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Draw title
      page.drawText(`${job.name || 'Web Pages PDF Report'}`, {
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
      
      // Add each URL with some content
      let yPosition = height - 120;
      const lineHeight = 15;
      
      for (let i = 0; i < job.urls.length; i++) {
        const url = job.urls[i];
        
        // Add new page if we're running out of space
        if (yPosition < 100) {
          const newPage = pdfDoc.addPage([595.28, 841.89]);
          yPosition = height - 50;
        }
        
        // URL title
        page.drawText(`${i + 1}. ${url}`, {
          x: 50,
          y: yPosition,
          size: 14,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight * 1.5;
        
        // Try to fetch minimal content
        try {
          const htmlContent = await fetchUrlContent(url);
          const { title, content } = extractMinimalContent(htmlContent, url);
          
          // Draw title
          page.drawText(title, {
            x: 70,
            y: yPosition,
            size: 12,
            font: boldFont,
            color: rgb(0, 0, 0),
          });
          yPosition -= lineHeight * 1.2;
          
          // Draw first 3 paragraphs at most
          const maxParagraphs = Math.min(3, content.length);
          for (let j = 0; j < maxParagraphs; j++) {
            // If text is too long, truncate it
            let text = content[j];
            if (text.length > 100) {
              text = text.substring(0, 97) + '...';
            }
            
            page.drawText(text, {
              x: 70,
              y: yPosition,
              size: 10,
              font: font,
              color: rgb(0, 0, 0),
            });
            yPosition -= lineHeight;
          }
          
          // Add space between URLs
          yPosition -= lineHeight;
          
        } catch (error) {
          page.drawText(`Error fetching content: ${error.message}`, {
            x: 70,
            y: yPosition,
            size: 10,
            font: font,
            color: rgb(0.8, 0, 0),
          });
          yPosition -= lineHeight * 2;
        }
      }
      
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
    console.log('Starting enhanced PDF generation...');
    const pdfBuffer = await generateEnhancedPDF(job);
    
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

const { parse } = require('url');
const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const https = require('https');

// Function for authentication verification
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
    console.error('Session verification error:', error);
    return null;
  }
}

// Simplified HTTP request function
async function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP request failed with status ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(data);
    }
    
    req.end();
    
    // Set a shorter timeout
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timeout after 30 seconds'));
    });
  });
}

// Function to generate a PDF using Browserless.io API - optimized for speed
async function generatePDFWithBrowserless(job) {
  try {
    const browserlessApiKey = process.env.BROWSERLESS_API_KEY;
    if (!browserlessApiKey) {
      throw new Error('Browserless API key is not configured');
    }
    
    // Only process the first URL for now to avoid timeout
    // We can enhance this later for multiple URLs
    const url = job.urls[0];
    
    const options = {
      method: 'POST',
      hostname: 'chrome.browserless.io',
      path: `/pdf?token=${browserlessApiKey}`,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    // Optimize request for speed
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
        }
      },
      // Faster page load strategy
      waitFor: 'load'  // Use 'load' instead of 'networkidle2' for faster processing
    });
    
    const pdfBuffer = await makeRequest(
      `https://chrome.browserless.io/pdf?token=${browserlessApiKey}`,
      options,
      requestBody
    );
    
    return pdfBuffer;
  } catch (error) {
    console.error('Error in Browserless PDF generation:', error);
    throw error;
  }
}

// Main handler for HTTP requests - optimized for speed
module.exports = async (req, res) => {
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
      job = await jobsCollection.findOne({ _id: jobId });
    }
    
    if (!job) {
      return res.status(404).send('Job not found');
    }
    
    // Check if the job belongs to the user or is public
    if (job.userId && user && job.userId !== user.sub && !job.isPublic) {
      return res.status(403).send('Unauthorized access to this job');
    }
    
    // Generate the PDF with optimized settings
    const pdfBuffer = await generatePDFWithBrowserless(job);
    
    // Update last generated timestamp
    jobsCollection.updateOne(
      { _id: job._id },
      { $set: { lastGenerated: new Date() } }
    ).catch(err => console.error('Error updating timestamp:', err));
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${job.name || 'generated'}-pdf.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send(`Error generating PDF: ${error.message}`);
  }
};

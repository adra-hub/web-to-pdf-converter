const { parse } = require('url');
const { connectToDatabase } = require('./db');
const { ObjectId } = require('mongodb');

// În locul generării directe a PDF-ului pe Vercel
// Facem o redirecționare către serviciul nostru de pe Render
module.exports = async (req, res) => {
  try {
    const { query } = parse(req.url, true);
    const jobId = query.id;
    
    if (!jobId) {
      return res.status(400).send('Missing job ID');
    }
    
    // Găsim job-ul în baza de date
    const db = await connectToDatabase();
    const jobsCollection = db.collection('jobs');
    
    // Încercăm să găsim job-ul
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
    
    // Actualizăm timestamp-ul ultimei generări
    jobsCollection.updateOne(
      { _id: job._id },
      { $set: { lastGenerated: new Date() } }
    ).catch(err => console.error('Error updating timestamp:', err));
    
    // Construim URL-ul către serviciul de pe Render
    // Înlocuiește "numele-tau-serviciu" cu numele real al serviciului tău Render
    const renderServiceUrl = `https://pdf-generator-service.onrender.com/generate-pdf?urls=${encodeURIComponent(job.urls.join(','))}&name=${encodeURIComponent(job.name || 'PDF Report')}&pageSize=${job.options?.pageSize || 'A4'}&landscape=${job.options?.landscape === true ? 'true' : 'false'}`;
    
    console.log(`Redirecting to Render service: ${renderServiceUrl}`);
    
    // Redirecționăm utilizatorul către serviciul de generare PDF
    res.redirect(307, renderServiceUrl);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error: ${error.message}`);
  }
};

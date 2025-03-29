const { connectToDatabase } = require('../db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');

// Funcție pentru verificarea autentificării
async function getUserFromRequest(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const session = cookies.session;

    if (!session) {
      return null;
    }

    // Verifică dacă SESSION_SECRET este definit
    if (!process.env.SESSION_SECRET) {
      console.error('SESSION_SECRET environment variable is not defined');
      return null;
    }

    const decoded = jwt.verify(session, process.env.SESSION_SECRET);
    return decoded.user;
  } catch (error) {
    console.error('Eroare la verificarea sesiunii:', error);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    // Verificăm utilizatorul
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in again.' });
    }

    // Conectare la baza de date
    const db = await connectToDatabase();
    const jobsCollection = db.collection('jobs');

    // Tratăm cererile în funcție de metoda HTTP
    switch (req.method) {
      case 'GET':
        // Listăm job-urile utilizatorului
        try {
          const jobs = await jobsCollection
            .find({ userId: user.sub })
            .sort({ createdAt: -1 })
            .toArray();
          
          return res.status(200).json(jobs);
        } catch (error) {
          console.error('Eroare la listarea job-urilor:', error);
          return res.status(500).json({ error: `Failed to fetch jobs: ${error.message}` });
        }

      case 'POST':
        // Creăm un job nou
        try {
          console.log('Creating new job with body:', JSON.stringify(req.body)); // Logging pentru debugging
          
          const { name, urls, options, isPublic } = req.body;
          
          if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: 'URLs are required and must be a non-empty array' });
          }
          
          // Verificăm formatul fiecărui URL
          const urlRegex = /^(https?:\/\/)[a-zA-Z0-9]+([\-\.]{1}[a-zA-Z0-9]+)*\.[a-zA-Z]{2,}(:[0-9]{1,5})?(\/.*)?$/;
          const invalidUrls = urls.filter(url => !urlRegex.test(url));
          if (invalidUrls.length > 0) {
            return res.status(400).json({ 
              error: 'Invalid URLs detected', 
              invalidUrls 
            });
          }
          
          // Creăm noul job
          const newJob = {
            name: name || `PDF Job ${new Date().toISOString()}`,
            urls,
            options: options || {
              pageSize: 'A4',
              landscape: false,
              expandAccordions: true,
              pageWidth: 1200,
              pageHeight: 1600
            },
            userId: user.sub,
            createdAt: new Date(),
            isPublic: isPublic || false
          };
          
          console.log('Inserting job into MongoDB:', JSON.stringify(newJob));
          
          const result = await jobsCollection.insertOne(newJob);
          
          // Adăugăm ID-ul și shareable link-ul
          newJob._id = result.insertedId;
          const baseUrl = process.env.VERCEL_URL || 
                         (req.headers.host ? (req.headers.host.includes('localhost') ? 
                          `http://${req.headers.host}` : `https://${req.headers.host}`) : '');
          
          newJob.shareableLink = `${baseUrl}/api/generate-pdf?id=${newJob._id}`;
          
          console.log('Job created successfully:', JSON.stringify(newJob));
          return res.status(201).json(newJob);
        } catch (error) {
          console.error('Eroare la crearea job-ului:', error);
          return res.status(500).json({ error: `Failed to create job: ${error.message}` });
        }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Eroare generală în API:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
};

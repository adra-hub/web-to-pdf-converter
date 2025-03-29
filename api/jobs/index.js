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

    const decoded = jwt.verify(session, process.env.SESSION_SECRET);
    return decoded.user;
  } catch (error) {
    console.error('Eroare la verificarea sesiunii:', error);
    return null;
  }
}

module.exports = async (req, res) => {
  // Verificăm utilizatorul
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
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
        return res.status(500).json({ error: 'Failed to fetch jobs' });
      }

    case 'POST':
      // Creăm un job nou
      try {
        const { name, urls, options } = req.body;
        
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return res.status(400).json({ error: 'URLs are required' });
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
          isPublic: false
        };
        
        const result = await jobsCollection.insertOne(newJob);
        
        // Adăugăm ID-ul și shareable link-ul
        newJob._id = result.insertedId;
        newJob.shareableLink = `${process.env.VERCEL_URL || req.headers.host}/api/generate-pdf?id=${newJob._id}`;
        
        return res.status(201).json(newJob);
      } catch (error) {
        console.error('Eroare la crearea job-ului:', error);
        return res.status(500).json({ error: 'Failed to create job' });
      }

    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
};

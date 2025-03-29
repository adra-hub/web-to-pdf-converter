const { ObjectId } = require('mongodb');
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

  // Obținem ID-ul din URL
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Job ID is required' });
  }

  // Conectare la baza de date
  const db = await connectToDatabase();
  const jobsCollection = db.collection('jobs');

  // Încercăm să convertim ID-ul la ObjectId
  let jobId;
  try {
    jobId = new ObjectId(id);
  } catch (e) {
    jobId = id; // Dacă nu e un ObjectId valid, folosim string-ul
  }

  // Tratăm cererile în funcție de metoda HTTP
  switch (req.method) {
    case 'GET':
      // Obținem un job specific
      try {
        const job = await jobsCollection.findOne({ _id: jobId, userId: user.sub });
        
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }
        
        return res.status(200).json(job);
      } catch (error) {
        console.error('Eroare la obținerea job-ului:', error);
        return res.status(500).json({ error: 'Failed to fetch job' });
      }

    case 'PUT':
      // Actualizăm un job
      try {
        const { name, urls, options, isPublic } = req.body;
        
        // Verificăm mai întâi dacă job-ul există și aparține utilizatorului
        const existingJob = await jobsCollection.findOne({ _id: jobId, userId: user.sub });
        
        if (!existingJob) {
          return res.status(404).json({ error: 'Job not found or unauthorized' });
        }
        
        // Pregătim datele de actualizare
        const updateData = {};
        
        if (name !== undefined) updateData.name = name;
        if (urls !== undefined && Array.isArray(urls) && urls.length > 0) updateData.urls = urls;
        if (options !== undefined) updateData.options = options;
        if (isPublic !== undefined) updateData.isPublic = isPublic;
        
        // Actualizăm job-ul
        await jobsCollection.updateOne(
          { _id: jobId },
          { $set: updateData }
        );
        
        // Obținem job-ul actualizat
        const updatedJob = await jobsCollection.findOne({ _id: jobId });
        
        return res.status(200).json(updatedJob);
      } catch (error) {
        console.error('Eroare la actualizarea job-ului:', error);
        return res.status(500).json({ error: 'Failed to update job' });
      }

    case 'DELETE':
      // Ștergem un job
      try {
        // Verificăm mai întâi dacă job-ul există și aparține utilizatorului
        const existingJob = await jobsCollection.findOne({ _id: jobId, userId: user.sub });
        
        if (!existingJob) {
          return res.status(404).json({ error: 'Job not found or unauthorized' });
        }
        
        // Ștergem job-ul
        await jobsCollection.deleteOne({ _id: jobId });
        
        return res.status(204).end();
      } catch (error) {
        console.error('Eroare la ștergerea job-ului:', error);
        return res.status(500).json({ error: 'Failed to delete job' });
      }

    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
};

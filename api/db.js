const { MongoClient } = require('mongodb');

// Variabilă pentru conexiunea caching
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  // Conectare la MongoDB
  const client = await MongoClient.connect(process.env.MONGODB_URI, {
    useUnifiedTopology: true,
  });

  const db = client.db('pdf-converter');
  cachedDb = db;
  return db;
}

module.exports = { connectToDatabase };

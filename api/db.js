const { MongoClient } = require('mongodb');

// Variabilă pentru conexiunea caching
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  // Verificăm dacă există URI-ul pentru MongoDB
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  try {
    // Conectare la MongoDB
    const client = await MongoClient.connect(process.env.MONGODB_URI, {
      useUnifiedTopology: true,
      maxPoolSize: 10, // Limităm numărul de conexiuni
      connectTimeoutMS: 10000, // Timeout de 10 secunde
      socketTimeoutMS: 45000, // Timeout de 45 secunde
    });

    const db = client.db(process.env.MONGODB_DB_NAME || 'Cluster0');
    
    // Verificăm conexiunea
    await db.command({ ping: 1 });
    console.log('Successfully connected to MongoDB');
    
    cachedDb = db;
    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

module.exports = { connectToDatabase };

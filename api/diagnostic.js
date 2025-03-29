const { connectToDatabase } = require('./db');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  const diagnosticResults = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'not set',
    environmentVariables: {
      auth0Domain: process.env.AUTH0_DOMAIN ? 'Set ✓' : 'Missing ✗',
      auth0ClientId: process.env.AUTH0_CLIENT_ID ? 'Set ✓' : 'Missing ✗',
      auth0ClientSecret: process.env.AUTH0_CLIENT_SECRET ? 'Set ✓' : 'Missing ✗',
      auth0CallbackUrl: process.env.AUTH0_CALLBACK_URL ? 'Set ✓' : 'Missing ✗',
      auth0LogoutUrl: process.env.AUTH0_LOGOUT_URL ? 'Set ✓' : 'Missing ✗',
      sessionSecret: process.env.SESSION_SECRET ? 'Set ✓' : 'Missing ✗',
      mongodbUri: process.env.MONGODB_URI ? 'Set ✓' : 'Missing ✗',
      vercelUrl: process.env.VERCEL_URL ? 'Set ✓' : 'Missing ✗'
    },
    request: {
      method: req.method,
      path: req.url,
      host: req.headers.host,
      userAgent: req.headers['user-agent'],
      hasCookies: !!req.headers.cookie
    },
    authentication: {
      status: 'Not checked yet'
    },
    database: {
      status: 'Not checked yet'
    }
  };

  // Check authentication
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const session = cookies.session;

    if (!session) {
      diagnosticResults.authentication.status = 'No session cookie found';
    } else {
      try {
        const decoded = jwt.verify(session, process.env.SESSION_SECRET);
        diagnosticResults.authentication.status = 'Valid session';
        diagnosticResults.authentication.userInfo = {
          sub: decoded.user.sub,
          name: decoded.user.name,
          expires: new Date(decoded.exp * 1000).toISOString()
        };
      } catch (jwtError) {
        diagnosticResults.authentication.status = 'Invalid session';
        diagnosticResults.authentication.error = jwtError.message;
      }
    }
  } catch (authError) {
    diagnosticResults.authentication.status = 'Authentication check failed';
    diagnosticResults.authentication.error = authError.message;
  }

  // Check database connection
  try {
    const db = await connectToDatabase();
    await db.command({ ping: 1 });
    diagnosticResults.database.status = 'Connected successfully';

    // Try to get collections info
    const collections = await db.listCollections().toArray();
    diagnosticResults.database.collections = collections.map(col => col.name);
    
    // Check if jobs collection exists and count documents
    if (collections.some(col => col.name === 'jobs')) {
      const jobsCount = await db.collection('jobs').countDocuments();
      diagnosticResults.database.jobsCount = jobsCount;
    }
  } catch (dbError) {
    diagnosticResults.database.status = 'Connection failed';
    diagnosticResults.database.error = dbError.message;
  }

  res.status(200).json(diagnosticResults);
};

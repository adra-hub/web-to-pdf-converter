const cookie = require('cookie');
const jwt = require('jsonwebtoken');

module.exports = (req, res) => {
  try {
    // Verifică dacă există un cookie de sesiune
    const cookies = cookie.parse(req.headers.cookie || '');
    const session = cookies.session;

    if (!session) {
      return res.status(401).json({ authenticated: false });
    }

    // Verifică și decodează token-ul JWT
    const decoded = jwt.verify(session, process.env.SESSION_SECRET);

    // Returnează informațiile utilizatorului
    res.json({
      authenticated: true,
      user: decoded.user,
    });
  } catch (error) {
    console.error('Eroare la verificarea sesiunii:', error);
    res.status(401).json({ authenticated: false });
  }
};

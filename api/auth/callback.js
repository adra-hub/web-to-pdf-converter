const { AuthenticationClient } = require('auth0');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  try {
    const { code, state } = req.query;
    const { returnTo } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Configurează clientul Auth0
    const auth0 = new AuthenticationClient({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
    });

    // Schimbă codul pentru token de acces
    const authResult = await auth0.oauth.authorizationCodeGrant({
      code,
      redirect_uri: process.env.AUTH0_CALLBACK_URL,
    });

    // Obține informațiile utilizatorului
    const user = await auth0.users.getInfo(authResult.access_token);

    // Creează un token JWT pentru sesiunea noastră
    const session = jwt.sign(
      {
        user: {
          sub: user.sub,
          name: user.name,
          email: user.email,
          picture: user.picture,
        },
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 1 săptămână
      },
      process.env.SESSION_SECRET
    );

    // Setează cookie-ul de sesiune
    res.setHeader(
      'Set-Cookie',
      cookie.serialize('session', session, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60, // 1 săptămână
      })
    );

    // Redirecționează înapoi la aplicație
    res.statusCode = 302;
    res.setHeader('Location', returnTo || '/');
    res.end();
  } catch (error) {
    console.error('Autentificare eșuată:', error);
    res.statusCode = 500;
    res.json({ error: 'Autentificare eșuată' });
  }
};

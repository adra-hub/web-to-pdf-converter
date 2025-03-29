const cookie = require('cookie');

module.exports = (req, res) => {
  // Șterge cookie-ul de sesiune
  res.setHeader(
    'Set-Cookie',
    cookie.serialize('session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );

  // Construiește URL-ul de logout din Auth0
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const returnTo = process.env.AUTH0_LOGOUT_URL;

  const logoutUrl = new URL(`https://${auth0Domain}/v2/logout`);
  logoutUrl.searchParams.set('client_id', clientId);
  logoutUrl.searchParams.set('returnTo', returnTo);

  res.statusCode = 302;
  res.setHeader('Location', logoutUrl.toString());
  res.end();
};

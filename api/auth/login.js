const { URL } = require('url');

module.exports = async (req, res) => {
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const callbackUrl = process.env.AUTH0_CALLBACK_URL;

  const returnTo = req.query.returnTo || '/';
  
  // Construiește URL-ul de autentificare Auth0
  const auth0LoginUrl = new URL(`https://${auth0Domain}/authorize`);
  auth0LoginUrl.searchParams.set('client_id', clientId);
  auth0LoginUrl.searchParams.set('redirect_uri', callbackUrl);
  auth0LoginUrl.searchParams.set('response_type', 'code');
  auth0LoginUrl.searchParams.set('scope', 'openid profile email');
  auth0LoginUrl.searchParams.set('state', Buffer.from(JSON.stringify({ returnTo })).toString('base64'));

  res.statusCode = 302;
  res.setHeader('Location', auth0LoginUrl.toString());
  res.end();
};

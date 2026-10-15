const app = require('../dist/app').default;
const { connectDatabase } = require('../dist/config/db');

let databaseConnection;

module.exports = async function handler(req, res) {
  const requestUrl = req.url || '/';
  const [pathname, query = ''] = requestUrl.split('?');
  const routePath = req.query && req.query.path;
  const routeSegments = Array.isArray(routePath)
    ? routePath
    : typeof routePath === 'string'
      ? routePath.split('/').filter(Boolean)
      : [];

  if (routeSegments.length > 0) {
    const forwardedQuery = new URLSearchParams(query);
    forwardedQuery.delete('path');
    const queryString = forwardedQuery.toString();
    req.url = `/api/${routeSegments.map(encodeURIComponent).join('/')}${queryString ? `?${queryString}` : ''}`;
  } else if (pathname === '/' && !routeSegments.length) {
    req.url = `/api/health${query ? `?${query}` : ''}`;
  } else if (pathname === '/api' || pathname.startsWith('/api/')) {
    req.url = `${pathname}${query ? `?${query}` : ''}`;
  } else {
    req.url = `/api${pathname.startsWith('/') ? '' : '/'}${pathname}${query ? `?${query}` : ''}`;
  }
  req.originalUrl = req.url;

  if (req.method === 'OPTIONS') {
    return app(req, res);
  }

  if (req.url.split('?')[0] === '/api/health') {
    return app(req, res);
  }

  try {
    if (!databaseConnection) {
      databaseConnection = connectDatabase().catch((error) => {
        databaseConnection = undefined;
        throw error;
      });
    }
    await databaseConnection;
    return app(req, res);
  } catch (error) {
    console.error('Failed to initialize backend request:', error);
    const description = String((error && error.message) || 'unknown database error');
    const notConfigured =
      (typeof error === 'object' && error !== null && error.name === 'MissingMongoUriError') ||
      description.includes('MONGODB_URI must be configured');
    const uri = process.env.MONGODB_URI || process.env.DB_URI || '';
    const host = (uri.match(/@([^/?#]+)/) || [])[1] || '(none)';
    console.error(`Database status - configured: ${Boolean(uri)}, host: ${host}`);

    if (!res.headersSent) {
      // Use raw Node response methods: Express has not run yet and Vercel's
      // node-bridge also honors statusCode/end on the provided response.
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        message: 'Backend service is not ready.',
        error: notConfigured ? 'MONGODB_URI_NOT_CONFIGURED' : 'MONGODB_CONNECTION_FAILED',
        detail: notConfigured
          ? description
          : `MongoDB could not be reached at ${host}.`,
      }));
    }
  }
};

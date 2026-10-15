const app = require('../dist/app').default;
const { connectDatabase } = require('../dist/config/db');

let databaseConnection;

module.exports = async function handler(req, res) {
  const requestPath = req.url || '/';
  if (!requestPath.startsWith('/api/')) {
    req.url = `/api${requestPath.startsWith('/') ? '' : '/'}${requestPath}`;
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
    if (!res.headersSent) {
      return res.status(503).json({ message: 'Backend service is not ready.' });
    }
  }
};

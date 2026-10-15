const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');
const app = require('../dist/app').default;
const vercelHandler = require('../api/index.js');
const { collection } = require('../dist/data/mongo');
const { verifyLaravelPassword } = require('../dist/data/auth');
const { errorHandler } = require('../dist/middleware/errorHandler');
const { ResumeImprovementError, SkillGapAnalysisError } = require('../dist/services/gemini');

let server;
let baseUrl;

async function requestThroughVercel(method, pathSegments = [], origin = 'http://localhost:5173') {
  const proxy = createServer((req, res) => {
    req.query = { path: pathSegments };
    if (pathSegments.length > 0) {
      req.url = `/api/index?path=${encodeURIComponent(pathSegments.join('/'))}`;
    }
    void vercelHandler(req, res);
  });
  await new Promise((resolve) => proxy.listen(0, resolve));
  const proxyBaseUrl = `http://127.0.0.1:${proxy.address().port}`;

  try {
    return await fetch(proxyBaseUrl, {
      method,
      headers: method === 'OPTIONS'
        ? {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type,authorization',
          }
        : {},
    });
  } finally {
    await new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('health endpoint preserves Laravel-compatible response fields', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'mongodb');
  assert.equal(typeof body.timestamp, 'string');
});

test('root endpoint confirms the backend is running', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('Vercel root request is mapped to the health endpoint', async () => {
  const response = await requestThroughVercel('GET');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('login preflight allows requests from the configured frontend', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(
    response.headers.get('access-control-allow-headers'),
    'content-type,authorization',
  );
});

test('Vercel catch-all restores nested paths for login preflight', async () => {
  const response = await requestThroughVercel('OPTIONS', 'auth/login');

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(
    response.headers.get('access-control-allow-headers'),
    'content-type,authorization',
  );
});

test('Vercel catch-all returns OK when the configured CORS origin does not match', async () => {
  const response = await requestThroughVercel(
    'OPTIONS',
    'auth/login',
    'https://next-frontend-iota-smoky.vercel.app',
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('readiness endpoint reports disconnected MongoDB without claiming readiness', async () => {
  const response = await fetch(`${baseUrl}/api/ready`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, 'unavailable');
});

test('skill-gap provider failures return a clear service-unavailable response', () => {
  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(new SkillGapAnalysisError(), {}, response, () => {});
  } finally {
    console.error = originalError;
  }

  assert.equal(statusCode, 503);
  assert.deepEqual(responseBody, {
    message: 'Skill analysis is temporarily unavailable. Please try again later.',
  });
});

test('resume improvement provider failures return a clear service-unavailable response', () => {
  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(new ResumeImprovementError(), {}, response, () => {});
  } finally {
    console.error = originalError;
  }

  assert.equal(statusCode, 503);
  assert.deepEqual(responseBody, {
    message: 'AI resume improvement is temporarily unavailable. Please try again shortly.',
  });
});

test('protected feature routes reject missing bearer tokens', async () => {
  const requests = [
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/refresh'],
    ['POST', '/api/skill-gap/analyze'],
    ['PUT', '/api/profile'],
    ['POST', '/api/profile/avatar'],
    ['DELETE', '/api/profile/avatar'],
    ['POST', '/api/profile/location'],
    ['GET', '/api/roadmaps'],
    ['POST', '/api/roadmaps/generate'],
    ['GET', '/api/roadmaps/example/videos'],
    ['GET', '/api/roadmaps/example'],
    ['DELETE', '/api/roadmaps/example'],
    ['GET', '/api/resumes'],
    ['POST', '/api/resumes/generate'],
    ['POST', '/api/resumes/improve-existing'],
    ['GET', '/api/resumes/example/download'],
    ['POST', '/api/resumes/example/photo'],
    ['GET', '/api/resumes/example'],
    ['PUT', '/api/resumes/example'],
    ['POST', '/api/progress/start'],
    ['POST', '/api/progress/example/complete'],
    ['POST', '/api/progress/example/track-video'],
    ['POST', '/api/progress/example/practice-task'],
    ['POST', '/api/progress/example/practice-submission'],
    ['GET', '/api/progress/roadmap/example'],
    ['GET', '/api/progress/weekly-insights'],
    ['GET', '/api/certificates'],
    ['POST', '/api/certificates/generate/example'],
    ['GET', '/api/certificates/example/download'],
    ['GET', '/api/gamification/leaderboard'],
    ['GET', '/api/gamification/badges'],
    ['GET', '/api/gamification/stats'],
    ['GET', '/api/quiz?video_id=v&video_title=t&skill_name=s'],
    ['POST', '/api/quiz/submit'],
    ['GET', '/api/admin/users'],
    ['DELETE', '/api/admin/users/example'],
    ['PATCH', '/api/admin/users/example/role'],
    ['GET', '/api/admin/stats'],
    ['GET', '/api/admin/practice-reviews'],
    ['POST', '/api/admin/practice-reviews/example'],
    ['DELETE', '/api/admin/certificates/example'],
    ['POST', '/api/admin/courses'],
    ['PUT', '/api/admin/courses/example'],
    ['DELETE', '/api/admin/courses/example'],
    ['POST', '/api/admin/courses/example/lessons'],
    ['PUT', '/api/admin/lessons/example'],
    ['DELETE', '/api/admin/lessons/example'],
  ];

  for (const [method, path] of requests) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path} should require authentication`);
  }
});

test('registration validates input before attempting database access', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', email: 'not-an-email', password: 'short' }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.message, 'Validation error');
  assert.ok(body.errors.name);
  assert.ok(body.errors.email);
  assert.ok(body.errors.password);
});

test('registration rejects an empty name independently of other fields', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', email: 'valid@example.com', password: 'valid-password' }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.ok(body.errors.name);
});

test('login validates an invalid email before attempting database access', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'valid-password' }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.ok(body.errors.email);
});

test('MongoDB models retain the Laravel collection names without strict field coercion', () => {
  const names = [
    'users',
    'personal_access_tokens',
    'user_stats',
    'roadmaps',
    'progress',
    'resumes',
    'certificates',
    'courses',
    'lessons',
    'enrollments',
    'quizzes',
  ];

  for (const name of names) {
    assert.equal(collection(name).collectionName, name);
  }
});

test('Laravel bcrypt hashes with the $2y$ prefix are accepted', async () => {
  const bcryptHash = await bcrypt.hash('password-compatible-check', 10);
  const laravelHash = bcryptHash.replace(/^\$2b\$/, '$2y$');

  assert.equal(await verifyLaravelPassword('password-compatible-check', laravelHash), true);
  assert.equal(await verifyLaravelPassword('not-the-password', laravelHash), false);
});

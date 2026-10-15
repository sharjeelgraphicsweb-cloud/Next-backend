const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { ObjectId } = require('mongodb');

const testDatabase = `b2test_${new ObjectId().toHexString()}`;
process.env.DB_DATABASE = testDatabase;

const mongoose = require('mongoose');
const pdfParse = require('pdf-parse');
const app = require('../dist/app').default;
const { env } = require('../dist/config/env');
const { collection } = require('../dist/data/mongo');

let server;
let baseUrl;
let userId;
let roadmapId;
let quizId;
let resumeId;
let certificateId;
let courseId;
let extraUserId;
let generatedQuizId;
let oauthEmail;
const uploadedFiles = [];
const email = `backend2-integration-${new ObjectId().toHexString()}@example.test`;

before(async () => {
  if (!env.MONGODB_URI) throw new Error('Set DB_URI in backend2/.env before running the isolated MongoDB integration suite.');
  await mongoose.connect(env.MONGODB_URI, { dbName: testDatabase, serverSelectionTimeoutMS: 8000 });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (userId) {
    const id = new ObjectId(userId);
    await Promise.all([
      collection('users').deleteOne({ _id: id }),
      collection('personal_access_tokens').deleteMany({
        $or: [{ tokenable_id: userId }, { tokenable_id: id }],
      }),
      collection('user_stats').deleteMany({ user_id: userId }),
      collection('roadmaps').deleteMany({ user_id: userId }),
      collection('progress').deleteMany({ user_id: userId }),
      collection('resumes').deleteMany({ user_id: userId }),
      collection('certificates').deleteMany({ user_id: userId }),
    ]);
  }
  if (roadmapId) await collection('roadmaps').deleteOne({ _id: new ObjectId(roadmapId) });
  if (quizId) await collection('quizzes').deleteOne({ _id: new ObjectId(quizId) });
  if (generatedQuizId) await collection('quizzes').deleteOne({ _id: new ObjectId(generatedQuizId) });
  if (resumeId) await collection('resumes').deleteOne({ _id: new ObjectId(resumeId) });
  if (certificateId) await collection('certificates').deleteOne({ _id: new ObjectId(certificateId) });
  if (courseId) {
    await collection('lessons').deleteMany({ course_id: courseId });
    await collection('courses').deleteOne({ _id: new ObjectId(courseId) });
  }
  if (extraUserId) await collection('users').deleteOne({ _id: new ObjectId(extraUserId) });
  if (oauthEmail) {
    const oauthUser = await collection('users').findOne({ email: oauthEmail });
    if (oauthUser) {
      const oauthUserId = oauthUser._id.toString();
      await Promise.all([
        collection('users').deleteOne({ _id: oauthUser._id }),
        collection('personal_access_tokens').deleteMany({ tokenable_id: oauthUserId }),
        collection('user_stats').deleteMany({ user_id: oauthUserId }),
      ]);
    }
  }
  await Promise.all(uploadedFiles.map(async (filename) => {
    try {
      await fs.unlink(path.join(process.cwd(), 'storage', 'uploads', filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }));
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('Laravel-compatible auth and database-backed feature workflows', async () => {
  const register = await request('/api/auth/register', 'POST', {
    name: 'Backend2 Integration',
    email,
    password: 'integration-password',
  });
  assert.equal(register.response.status, 201);
  userId = register.body.user.id;
  assert.equal(register.body.token_type, 'Bearer');
  assert.ok(register.body.access_token);
  assert.equal(register.body.refresh_token, register.body.access_token);

  const firstToken = register.body.access_token;
  const login = await request('/api/auth/login', 'POST', { email, password: 'integration-password' });
  assert.equal(login.response.status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, firstToken)).response.status, 401);
  let token = login.body.access_token;

  const me = await request('/api/auth/me', 'GET', undefined, token);
  assert.equal(me.body.id, userId);
  const profile = await request('/api/profile', 'PUT', { name: 'Updated Integration User' }, token);
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.user.name, 'Updated Integration User');
  const location = await request('/api/profile/location', 'POST', { lat: 37.5, lng: -122.2 }, token);
  assert.deepEqual(location.body.location, { lat: 37.5, lng: -122.2 });
  const image = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZ8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const avatarForm = new FormData();
  avatarForm.append('image', image, 'avatar.png');
  const avatar = await request('/api/profile/avatar', 'POST', avatarForm, token);
  assert.equal(avatar.response.status, 200);
  uploadedFiles.push(path.basename(new URL(avatar.body.avatar_url).pathname));
  assert.equal((await request('/api/profile/avatar', 'DELETE', undefined, token)).response.status, 200);

  assert.equal((await request('/api/roadmaps', 'GET', undefined, token)).response.status, 200);

  const roadmap = {
    _id: new ObjectId(),
    user_id: userId,
    target_role: 'Integration Engineer',
    nodes: [
      { id: 1, skill_name: 'Testing', title: 'Testing basics' },
      { id: 2, skill_name: 'MongoDB', title: 'MongoDB basics' },
    ],
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  };
  roadmapId = roadmap._id.toString();
  await collection('roadmaps').insertOne(roadmap);

  const start = await request('/api/progress/start', 'POST', { roadmap_id: roadmapId }, token);
  assert.equal(start.response.status, 201);
  const progressId = start.body.data.id;
  const taskId = start.body.data.practice_tasks[0].task_id;
  const task = await request(`/api/progress/${progressId}/practice-task`, 'POST', {
    task_id: taskId,
    portfolio_url: 'https://example.test/portfolio',
    submission_notes: 'Integration test submission',
    completed: true,
  }, token);
  assert.equal(task.body.practice_tasks[0].mentor_review_status, 'submitted');
  const submissionForm = new FormData();
  submissionForm.append('task_id', taskId);
  submissionForm.append('file', new Blob(['temporary practice submission'], { type: 'text/plain' }), 'submission.txt');
  const submission = await request(`/api/progress/${progressId}/practice-submission`, 'POST', submissionForm, token);
  assert.equal(submission.response.status, 200);
  uploadedFiles.push(path.basename(new URL(submission.body.practice_tasks[0].submission_file_url).pathname));

  await collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { role: 'admin' } });
  const roleChanged = await request(`/api/admin/users/${userId}/role`, 'PATCH', { role: 'user' }, token);
  assert.equal(roleChanged.response.status, 200);
  await collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { role: 'admin' } });
  assert.equal((await request('/api/admin/users', 'GET', undefined, token)).response.status, 200);
  assert.equal((await request('/api/admin/stats', 'GET', undefined, token)).response.status, 200);
  const extraUser = { _id: new ObjectId(), name: 'Temporary Admin Delete Target', email: `delete-${new ObjectId().toHexString()}@example.test`, password: 'not-used', role: 'user' };
  extraUserId = extraUser._id.toString();
  await collection('users').insertOne(extraUser);
  assert.equal((await request(`/api/admin/users/${extraUserId}`, 'DELETE', undefined, token)).response.status, 200);
  const review = await request(`/api/admin/practice-reviews/${progressId}`, 'POST', {
    task_id: taskId,
    status: 'approved',
    mentor_feedback: 'Looks good',
  }, token);
  assert.equal(review.response.status, 200);
  assert.equal((await request('/api/admin/practice-reviews', 'GET', undefined, token)).body.reviews.length, 1);

  for (const nodeId of [1, 2]) {
    const completed = await request(`/api/progress/${progressId}/complete`, 'POST', { node_id: nodeId }, token);
    assert.equal(completed.response.status, 200);
  }
  const roadmapProgress = await request(`/api/progress/roadmap/${roadmapId}`, 'GET', undefined, token);
  assert.deepEqual(roadmapProgress.body.node_progress.map((node) => node.node_id), [1, 2]);

  const questions = Array.from({ length: 5 }, (_, index) => ({
    question: `Question ${index + 1}`,
    options: ['A', 'B', 'C', 'D'],
    correct_answer: 'A',
    explanation: 'Answer A is correct.',
  }));
  const quiz = { _id: new ObjectId(), video_id: `integration-${new ObjectId().toHexString()}`, questions };
  quizId = quiz._id.toString();
  await collection('quizzes').insertOne(quiz);
  const publicQuiz = await request(`/api/quiz?video_id=${quiz.video_id}&video_title=Test&skill_name=Testing`, 'GET', undefined, token);
  assert.equal(publicQuiz.response.status, 200);
  assert.equal('correct_answer' in publicQuiz.body.data.questions[0], false);
  const submittedQuiz = await request('/api/quiz/submit', 'POST', {
    quiz_id: quizId,
    answers: ['A', 'A', 'A', 'A', 'A'],
    progress_id: progressId,
    node_id: 1,
  }, token);
  assert.equal(submittedQuiz.body.data.passed, true);

  const certificate = await request(`/api/certificates/generate/${roadmapId}`, 'POST', {}, token);
  assert.equal(certificate.response.status, 201);
  certificateId = certificate.body.data.id;
  const verification = await request(`/api/certificates/verify/${certificate.body.data.certificate_code}`, 'GET');
  assert.equal(verification.body.valid, true);
  assert.equal((await request('/api/certificates', 'GET', undefined, token)).body.data.length, 1);
  const certificatePdf = await request(`/api/certificates/${certificateId}/download`, 'GET', undefined, token);
  assert.equal(certificatePdf.response.status, 200);
  assert.match(certificatePdf.response.headers.get('content-type'), /application\/pdf/);
  const certificatePdfBuffer = Buffer.from(certificatePdf.body);
  assert.ok(certificatePdfBuffer.toString('latin1').startsWith('%PDF-'));
  const { text: certificatePdfText } = await pdfParse(certificatePdfBuffer);
  for (const text of [
    'CERTIFICATE OF COMPLETION',
    'has successfully completed',
    'Integration Engineer',
    'SCAN TO VERIFY',
    `ID: ${certificate.body.data.certificate_code}`,
    `/certificates/verify/${certificate.body.data.certificate_code}`,
  ]) {
    assert.ok(certificatePdfText.includes(text), `PDF certificate should include "${text}" from the HTML template`);
  }
  assert.ok((certificatePdfBuffer.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length >= 2, 'PDF certificate should embed the brand logo and QR code.');

  const certificateDocx = await request(`/api/certificates/${certificateId}/download?format=docx`, 'GET', undefined, token);
  assert.equal(certificateDocx.response.status, 200);
  assert.match(certificateDocx.response.headers.get('content-type'), /wordprocessingml\.document/);
  assert.ok(Buffer.from(certificateDocx.body).subarray(0, 2).toString() === 'PK', 'DOCX certificate should be a valid ZIP-based document.');

  const resume = {
    _id: new ObjectId(),
    user_id: userId,
    title: 'Integration Resume',
    target_role: 'Engineer',
    meta_data: {},
    resume_data: { summary: 'Test summary' },
    created_at: new Date(),
    updated_at: new Date(),
  };
  resumeId = resume._id.toString();
  await collection('resumes').insertOne(resume);
  assert.equal((await request('/api/resumes', 'GET', undefined, token)).body.length, 1);
  assert.equal((await request(`/api/resumes/${resumeId}`, 'GET', undefined, token)).response.status, 200);
  const updatedResume = await request(`/api/resumes/${resumeId}`, 'PUT', { title: 'Updated Resume' }, token);
  assert.equal(updatedResume.body.title, 'Updated Resume');
  assert.equal((await request(`/api/resumes/${resumeId}/download`, 'GET', undefined, token)).response.status, 200);
  const resumePhotoForm = new FormData();
  resumePhotoForm.append('image', image, 'resume-photo.png');
  assert.equal((await request(`/api/resumes/${resumeId}/photo`, 'POST', resumePhotoForm, token)).response.status, 200);
  uploadedFiles.push(path.basename(new URL((await collection('resumes').findOne({ _id: new ObjectId(resumeId) })).photo_url).pathname));
  const resumePdf = await request(`/api/resumes/${resumeId}/download?format=pdf`, 'GET', undefined, token);
  assert.equal(resumePdf.response.status, 200);
  const resumePdfBuffer = Buffer.from(resumePdf.body);
  assert.ok((resumePdfBuffer.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length >= 1, 'PDF resume should embed the uploaded profile photo.');
  assert.match((await pdfParse(resumePdfBuffer)).text, /Test summary/, 'PDF resume should retain its resume content.');

  const course = await request('/api/admin/courses', 'POST', {
    title: `Backend2 Integration ${new ObjectId().toHexString()}`,
    description: 'Temporary integration course',
    instructor_id: userId,
    category: 'Testing',
    level: 'beginner',
    duration_hours: 1,
    price: 0,
    is_published: true,
  }, token);
  assert.equal(course.response.status, 201);
  courseId = course.body.data.id;
  assert.equal((await request('/api/courses', 'GET')).response.status, 200);
  const lesson = await request(`/api/admin/courses/${courseId}/lessons`, 'POST', {
    title: 'Integration Lesson',
    description: 'Temporary integration lesson',
    video_url: 'https://example.test/video',
    duration_minutes: 10,
    order: 1,
  }, token);
  assert.equal(lesson.response.status, 201);
  assert.equal((await request(`/api/admin/courses/${courseId}`, 'PUT', { title: 'Updated Integration Course' }, token)).response.status, 200);
  assert.equal((await request(`/api/admin/lessons/${lesson.body.data.id}`, 'PUT', { title: 'Updated Integration Lesson' }, token)).response.status, 200);
  assert.equal((await request(`/api/courses/${courseId}`, 'GET')).body.data.lessons.length, 1);
  assert.equal((await request(`/api/admin/lessons/${lesson.body.data.id}`, 'DELETE', undefined, token)).response.status, 200);
  assert.equal((await request(`/api/admin/courses/${courseId}`, 'DELETE', undefined, token)).response.status, 200);
  assert.equal((await request(`/api/admin/certificates/${certificateId}`, 'DELETE', undefined, token)).response.status, 200);

  assert.equal((await request('/api/gamification/leaderboard', 'GET', undefined, token)).response.status, 200);
  assert.equal((await request('/api/gamification/badges', 'GET', undefined, token)).response.status, 200);
  assert.equal((await request('/api/progress/weekly-insights', 'GET', undefined, token)).response.status, 200);
  assert.equal((await request(`/api/progress/${progressId}/track-video`, 'POST', { video_id: 'integration-video' }, token)).response.status, 200);
  assert.equal((await request(`/api/roadmaps/${roadmapId}`, 'GET', undefined, token)).response.status, 200);
  const stats = await request('/api/gamification/stats', 'GET', undefined, token);
  assert.ok(stats.body.xp >= 340);
  const refreshed = await request('/api/auth/refresh', 'POST', {}, token);
  assert.equal(refreshed.response.status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, token)).response.status, 401);
  token = refreshed.body.access_token;
  assert.equal((await request('/api/auth/logout', 'POST', {}, token)).response.status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, token)).response.status, 401);
});

test('AI and Google OAuth routes preserve their contracts with mocked providers', async () => {
  const login = await request('/api/auth/login', 'POST', { email, password: 'integration-password' });
  const token = login.body.access_token;

  const videos = await request(`/api/roadmaps/${roadmapId}/videos?skill=Testing&language=Urdu`, 'GET', undefined, token, true);
  assert.equal(videos.body.videos[0].video_id, 'abcdefghijk');
  assert.equal(videos.body.language, 'Urdu');
  assert.equal((await request(`/api/roadmaps/${roadmapId}`, 'DELETE', undefined, token)).response.status, 200);

  const analysis = await request('/api/skill-gap/analyze', 'POST', {
    target_role: 'Integration Engineer',
    description: 'Build production services',
    language: 'English',
  }, token, true);
  assert.equal(analysis.body.skill_gaps[0], 'MongoDB');

  const generatedRoadmap = await request('/api/roadmaps/generate', 'POST', {
    target_role: 'AI Integration Engineer',
    description: 'Learn AI backend development',
    current_skills: ['TypeScript'],
    skill_gaps: ['Gemini API'],
    language: 'English',
  }, token, true);
  assert.equal(generatedRoadmap.response.status, 201);
  assert.deepEqual(generatedRoadmap.body.nodes.map((node) => node.id), [1, 2, 3, 4, 5]);

  const generatedQuiz = await request('/api/quiz?video_id=generated-integration-video&video_title=Generated&skill_name=Testing', 'GET', undefined, token, true);
  assert.equal(generatedQuiz.body.data.questions.length, 10);
  generatedQuizId = generatedQuiz.body.data.id;

  const generatedResume = await request('/api/resumes/generate', 'POST', {
    prompt: 'Create a professional software engineering resume.',
    target_role: 'Software Engineer',
    raw_input: 'Candidate has backend development experience.',
  }, token, true);
  assert.equal(generatedResume.response.status, 201);
  assert.equal(generatedResume.body.resume_data.personal_info.professional_title, 'Integration Engineer');

  const improvedPdf = await createPdfBuffer();
  const improvedResumeForm = new FormData();
  improvedResumeForm.append('target_role', 'Integration Engineer');
  improvedResumeForm.append('resume', new Blob([improvedPdf], { type: 'application/pdf' }), 'resume.pdf');
  const improvedResume = await request('/api/resumes/improve-existing', 'POST', improvedResumeForm, token, true);
  assert.equal(improvedResume.response.status, 201);
  assert.deepEqual(improvedResume.body.gap_analysis.current_skills, ['TypeScript']);
  assert.deepEqual(improvedResume.body.gap_analysis.skill_gaps, ['MongoDB']);
  assert.equal(improvedResume.body.resume.resume_data.work_experience[0].company, 'Actual Integration Employer');

  oauthEmail = 'oauth-backend2-integration@example.test';
  const googleRedirect = await request('/api/auth/google', 'GET', undefined, undefined, true, 'manual');
  assert.equal(googleRedirect.response.status, 302);
  const callback = await request('/api/auth/google/callback?code=integration-code', 'GET', undefined, undefined, true, 'manual');
  assert.equal(callback.response.status, 302);
  const redirect = new URL(callback.response.headers.get('location'));
  assert.equal(redirect.pathname, '/auth/google/callback');
  assert.ok(redirect.searchParams.get('token'));
});

async function request(path, method, body, token, useMockProviders = false, redirect = 'follow') {
  const send = async () => {
    const headers = {};
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      redirect,
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const contentType = response.headers.get('content-type') || '';
    const responseBody = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
    return { response, body: responseBody };
  };
  return useMockProviders ? withMockProviders(send) : send();
}

async function withMockProviders(callback) {
  const originalFetch = global.fetch;
  const { env } = require('../dist/config/env');
  const originalEnv = { ...env };
  env.GEMINI_API_KEY = 'mock-gemini-key';
  env.YOUTUBE_API_KEY = 'mock-youtube-key';
  env.GOOGLE_CLIENT_ID = 'mock-google-client';
  env.GOOGLE_CLIENT_SECRET = 'mock-google-secret';
  env.GOOGLE_REDIRECT_URL = `${baseUrl}/api/auth/google/callback`;
  const questions = Array.from({ length: 10 }, (_, index) => ({
    question: `Generated question ${index + 1}`,
    options: ['A', 'B', 'C', 'D'],
    correct_answer: 'A',
    explanation: 'A is correct.',
  }));
  const resumeBlueprint = {
    meta_data: { recommended_template_id: 'TEMPL_TECH_MINIMAL', ats_score_forecast: '80' },
    resume_data: {
      personal_info: { full_name: 'Integration Candidate', professional_title: 'Integration Engineer', email },
      summary: 'Integration test resume summary.',
      skills: { hard_skills: ['TypeScript'], tools_technologies: [], soft_skills: [] },
      work_experience: [],
      education: [],
      languages: [],
      certifications: [],
    },
  };

  global.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === new URL(baseUrl).origin) return originalFetch(input, init);
    if (url.hostname === 'generativelanguage.googleapis.com') {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      let result;
      if (prompt.includes('career advisor and technical recruiter')) {
        result = { current_skills: ['TypeScript'], required_skills: ['MongoDB'], skill_gaps: ['MongoDB'] };
      } else if (prompt.includes('professional, job-ready learning roadmap')) {
        result = Array.from({ length: 5 }, (_, index) => ({
          id: 99,
          order: 99,
          title: `Generated lesson ${index + 1}`,
          description: 'Generated integration roadmap lesson.',
          skill_name: 'Testing',
        }));
      } else if (prompt.includes('Generate a professional technical quiz')) {
        result = questions;
      } else if (prompt.includes('Never invent candidate names, employers')) {
        result = {
          meta_data: {
            recommended_template_id: 'TEMPL_TECH_MINIMAL',
            current_skills: ['TypeScript'],
            required_skills: ['MongoDB'],
            identified_skill_gaps: ['MongoDB'],
          },
          resume_data: {
            personal_info: {
              full_name: 'Integration Candidate',
              professional_title: 'Integration Engineer',
              email,
            },
            summary: 'Experienced integration engineer with proven backend delivery experience.',
            skills: { hard_skills: ['TypeScript', 'MongoDB'], tools_technologies: [], soft_skills: [] },
            work_experience: [{
              company: 'Actual Integration Employer',
              role: 'Integration Engineer',
              achievements: ['Delivered a production integration using TypeScript.'],
            }],
            education: [{ degree: 'BSc', institution: 'Integration University', year: '2024' }],
            languages: ['English'],
            certifications: [],
          },
        };
      } else {
        result = resumeBlueprint;
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/search') {
      return jsonResponse({ items: [{ id: { videoId: 'abcdefghijk' } }] });
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/videos') {
      return jsonResponse({
        items: [{
          id: 'abcdefghijk',
          snippet: { title: 'Mock YouTube tutorial', thumbnails: { high: { url: 'https://example.test/thumbnail.png' } } },
          contentDetails: { duration: 'PT15M' },
        }],
      });
    }
    if (url.hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'mock-provider-token' });
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v2/userinfo') {
      return jsonResponse({
        id: 'mock-google-user',
        name: 'OAuth Integration User',
        email: oauthEmail,
        picture: 'https://example.test/avatar.png',
      });
    }
    throw new Error(`Unexpected external provider request to ${url.hostname}${url.pathname}.`);
  };
  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
    Object.assign(env, originalEnv);
  }
}

async function createPdfBuffer() {
  return fs.readFile(path.join(process.cwd(), 'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf'));
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

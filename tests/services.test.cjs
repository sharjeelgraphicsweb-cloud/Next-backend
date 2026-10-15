const assert = require('node:assert/strict');
const { test } = require('node:test');
const { env } = require('../dist/config/env');
const {
  analyzeSkillGap,
  generateImprovedResume,
  generateJson,
  generateQuiz,
  generateResume,
  getYoutubeResources,
} = require('../dist/services/gemini');

test('Gemini skill-gap and quiz responses preserve their Laravel service contracts', async () => {
  const originalFetch = global.fetch;
  const originalKey = env.GEMINI_API_KEY;
  global.fetch = async () => jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ current_skills: ['JavaScript'], required_skills: ['TypeScript'], skill_gaps: ['TypeScript'] }) }] } }],
  });
  env.GEMINI_API_KEY = 'unit-test-key';
  try {
    const analysis = await analyzeSkillGap('resume', 'Engineer', 'career goal', 'English');
    assert.deepEqual(analysis.skill_gaps, ['TypeScript']);

    const questions = Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index + 1}`,
      options: ['A', 'B', 'C', 'D'],
      correct_answer: 'A',
      explanation: 'A is correct',
    }));
    global.fetch = async () => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(questions) }] } }] });
    assert.equal((await generateQuiz('Video', 'Testing')).length, 5);
  } finally {
    global.fetch = originalFetch;
    env.GEMINI_API_KEY = originalKey;
  }
});

test('skill-gap analysis reports provider failures instead of returning empty success data', async () => {
  const originalFetch = global.fetch;
  const originalKey = env.GEMINI_API_KEY;
  global.fetch = async () => new Response('{}', { status: 503 });
  env.GEMINI_API_KEY = 'unit-test-key';
  try {
    await assert.rejects(
      analyzeSkillGap('resume', 'Engineer', 'career goal', 'English'),
      { name: 'SkillGapAnalysisError', message: 'Skill analysis is temporarily unavailable. Please try again later.' },
    );
  } finally {
    global.fetch = originalFetch;
    env.GEMINI_API_KEY = originalKey;
  }
});

test('skill-gap analysis retries a transient Gemini service failure', async () => {
  const originalFetch = global.fetch;
  const originalKey = env.GEMINI_API_KEY;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('{}', { status: 503 });
    return jsonResponse({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ current_skills: ['JavaScript'], required_skills: ['React'], skill_gaps: ['React'] }) }],
        },
      }],
    });
  };
  env.GEMINI_API_KEY = 'unit-test-key';
  try {
    const analysis = await analyzeSkillGap('resume', 'Engineer', 'career goal', 'English');
    assert.equal(calls, 2);
    assert.deepEqual(analysis.skill_gaps, ['React']);
  } finally {
    global.fetch = originalFetch;
    env.GEMINI_API_KEY = originalKey;
  }
});

test('Gemini rate limits fall back to the available flash-lite model', async () => {
  const originalFetch = global.fetch;
  const originalKey = env.GEMINI_API_KEY;
  const requestedModels = [];
  global.fetch = async (input) => {
    const url = new URL(input);
    requestedModels.push(url.pathname.split('/').at(-1).split(':')[0]);
    if (requestedModels.length === 1) return new Response('{}', { status: 429 });
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ result: 'available' }) }] } }],
    });
  };
  env.GEMINI_API_KEY = 'unit-test-key';
  try {
    assert.deepEqual(await generateJson('synthetic test prompt'), { result: 'available' });
    assert.deepEqual(requestedModels, ['gemini-flash-latest', 'gemini-flash-lite-latest']);
  } finally {
    global.fetch = originalFetch;
    env.GEMINI_API_KEY = originalKey;
  }
});

test('resume improvement preserves detailed provider content and includes skill analysis metadata', async () => {
  const originalFetch = global.fetch;
  const originalKey = env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  let promptText = '';
  global.fetch = async (_input, init) => {
    promptText = JSON.parse(init.body).contents[0].parts[0].text;
    return jsonResponse({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              meta_data: {
                recommended_template_id: 'TEMPL_TECH_MINIMAL',
                current_skills: ['JavaScript'],
                required_skills: ['React'],
                identified_skill_gaps: ['React'],
              },
              resume_data: {
                personal_info: { full_name: 'Test Candidate', professional_title: 'Frontend Developer' },
                summary: 'Experienced frontend engineer.',
                skills: { hard_skills: ['JavaScript', 'React'], soft_skills: [], tools_technologies: ['Git'] },
                work_experience: [{ company: 'Actual Employer', role: 'Developer', achievements: ['Improved page performance by [ADD METRIC].'] }],
                education: [{ degree: 'BSc', institution: 'Test University', year: '2024' }],
              },
            }),
          }],
        },
      }],
    });
  };
  env.GEMINI_API_KEY = 'unit-test-key';
  console.warn = () => {};
  try {
    const result = await generateImprovedResume({
      target_role: 'Frontend Developer',
      raw_resume_text: 'Original resume facts',
    });
    assert.match(promptText, /Never invent candidate names, employers/);
    assert.match(promptText, /Existing Resume Text:/);
    assert.equal(result.resume_data.work_experience[0].company, 'Actual Employer');
    assert.deepEqual(result.meta_data.identified_skill_gaps, ['React']);
    assert.ok(result.meta_data.ats_breakdown);
  } finally {
    global.fetch = originalFetch;
    env.GEMINI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

test('resume improvement reports provider failures instead of returning a fabricated resume', async () => {
  const originalFetch = global.fetch;
  const originalKey = env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  global.fetch = async () => new Response('{}', { status: 429 });
  env.GEMINI_API_KEY = 'unit-test-key';
  console.warn = () => {};
  try {
    await assert.rejects(
      generateImprovedResume({ target_role: 'Engineer', raw_resume_text: 'Real resume facts' }),
      {
        name: 'ResumeImprovementError',
        message: 'AI resume improvement is temporarily unavailable. Please try again shortly.',
      },
    );
  } finally {
    global.fetch = originalFetch;
    env.GEMINI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

test('new resume generation falls back to a Laravel-compatible blueprint without a provider key', async () => {
  const originalKey = env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  env.GEMINI_API_KEY = '';
  console.warn = () => {};
  try {
    const regular = await generateResume({
      target_role: 'Software Engineer',
      industry: 'Software',
      experience_level: 'Senior',
      raw_input: 'Candidate background',
    });
    assert.equal(regular.meta_data.recommended_template_id, 'TEMPL_TECH_MINIMAL');
    assert.equal(regular.meta_data.ats_score_forecast, '64');
    assert.equal(regular.resume_data.personal_info.professional_title, 'Software Engineer');

  } finally {
    env.GEMINI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

test('YouTube API no-result responses fall through to Gemini videos', async () => {
  const originalFetch = global.fetch;
  const originalYoutubeKey = env.YOUTUBE_API_KEY;
  const originalGeminiKey = env.GEMINI_API_KEY;
  env.YOUTUBE_API_KEY = 'unit-test-youtube-key';
  env.GEMINI_API_KEY = 'unit-test-gemini-key';
  const providerCalls = [];
  global.fetch = async (input) => {
    const url = new URL(input);
    providerCalls.push(url.hostname);
    if (url.hostname === 'www.googleapis.com') return jsonResponse({ items: [] });
    return jsonResponse({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify([{ title: 'Testing tutorial', video_id: 'abcdefghijk', duration: '15 min' }]),
          }],
        },
      }],
    });
  };
  try {
    const videos = await getYoutubeResources('Testing', 'Urdu');
    assert.equal(providerCalls[0], 'www.googleapis.com');
    assert.equal(providerCalls[1], 'generativelanguage.googleapis.com');
    assert.equal(videos[0].video_id, 'abcdefghijk');
    assert.equal(videos[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  } finally {
    global.fetch = originalFetch;
    env.YOUTUBE_API_KEY = originalYoutubeKey;
    env.GEMINI_API_KEY = originalGeminiKey;
  }
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

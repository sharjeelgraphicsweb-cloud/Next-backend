import { env } from '../config/env';

const modelNames = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const retryableStatuses = [500, 502, 503, 504];

export class SkillGapAnalysisError extends Error {
  constructor() {
    super('Skill analysis is temporarily unavailable. Please try again later.');
    this.name = 'SkillGapAnalysisError';
  }
}

export class ResumeImprovementError extends Error {
  constructor() {
    super('AI resume improvement is temporarily unavailable. Please try again shortly.');
    this.name = 'ResumeImprovementError';
  }
}

export async function generateJson<T>(prompt: string): Promise<T> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');

  let response: Response | undefined;
  for (let modelIndex = 0; modelIndex < modelNames.length; modelIndex += 1) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelNames[modelIndex]}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (response.ok) break;
      const canUseFallback = response.status === 429 || retryableStatuses.includes(response.status);
      if (!canUseFallback) break;
      await response.body?.cancel();
      if (response.status === 429 || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    if (response?.ok || !response || ![429, ...retryableStatuses].includes(response.status)) break;
  }
  if (!response) throw new Error('Gemini request did not produce a response.');
  if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}.`);

  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty response.');

  const start = Math.min(...[text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0));
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < start) throw new Error('Gemini returned invalid JSON.');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export async function analyzeSkillGap(
  resumeText: string,
  targetRole: string,
  description: string,
  language: string,
): Promise<{ current_skills: string[]; required_skills: string[]; skill_gaps: string[] }> {
  const prompt = `You are an expert career advisor and technical recruiter.
Analyze the following resume text against the target role and the user's personal goal.

Target Role: ${targetRole}
User's Goal/Description: ${description}
Preferred Learning Language: ${language}

Resume Text:
${resumeText}

Identify:
1. Current Skills (found in resume that are relevant to the role)
2. Required Skills (standard industry requirements for this role)
3. Skill Gaps (required skills missing or weak in the resume)

Return ONLY a valid JSON object with these keys: 'current_skills' (array), 'required_skills' (array), 'skill_gaps' (array).`;
  try {
    const analysis = await generateJson<{
      current_skills: string[];
      required_skills: string[];
      skill_gaps: string[];
    }>(prompt);
    if (
      !analysis ||
      !Array.isArray(analysis.current_skills) ||
      !Array.isArray(analysis.required_skills) ||
      !Array.isArray(analysis.skill_gaps) ||
      ![...analysis.current_skills, ...analysis.required_skills, ...analysis.skill_gaps].every(
        (skill) => typeof skill === 'string',
      )
    ) {
      throw new Error('Gemini returned an invalid skill-gap response.');
    }
    return analysis;
  } catch (error) {
    console.warn('Gemini skill-gap provider failed.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown provider error.',
    });
    throw new SkillGapAnalysisError();
  }
}

export async function generateRoadmap(
  targetRole: string,
  skillGaps: string[],
  description: string,
  language: string,
): Promise<Array<Record<string, unknown>>> {
  const prompt = `Create a professional, job-ready learning roadmap for the role of '${targetRole}'.
User Goal: ${description}
Preferred Learning Language: ${language}
The user needs to focus on these specific gaps: ${skillGaps.join(', ')}

The roadmap should be highly structured and cover everything needed to be JOB-READY.
Write node titles and descriptions in ${language} when possible, while keeping skill_name in widely searchable technical terms.

Return a JSON array of 'nodes'. Each node must have:
- title: Clear learning objective
- description: Detailed what to learn
- skill_name: The core technology/skill (used for video fetching)
- estimated_time: (e.g., '1 week')
- level: (Beginner, Intermediate, or Advanced)
- order: (Integer)

Return ONLY the valid JSON array of nodes.`;
  try {
    return await generateJson(prompt);
  } catch (error) {
    console.warn('Gemini roadmap provider failed.', { name: error instanceof Error ? error.name : 'UnknownError' });
    return [];
  }
}

export async function generateQuiz(videoTitle: string, skillName: string): Promise<Array<Record<string, unknown>>> {
  const prompt = `Generate a professional technical quiz for the video tutorial: '${videoTitle}'.
The skill focus is: '${skillName}'.

Return exactly 10 multiple-choice questions (MCQs) in a valid JSON array.
Each question object must have:
1. 'question': The question text.
2. 'options': An array of 4 possible answers.
3. 'correct_answer': The exact string from the options that is correct.
4. 'explanation': A short explanation of why this answer is correct.

Make sure the questions range from beginner to intermediate.
Return ONLY the valid JSON array of 10 questions.`;
  try {
    const questions = await generateJson<Array<Record<string, unknown>>>(prompt);
    return Array.isArray(questions) && questions.length >= 5 ? questions : [];
  } catch (error) {
    console.warn('Gemini quiz provider failed.', { name: error instanceof Error ? error.name : 'UnknownError' });
    return [];
  }
}

export async function generateResume(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  let generated: Record<string, unknown>;
  try {
    generated = await generateJson<Record<string, unknown>>(buildResumePrompt(payload));
    if (!isRecord(generated.resume_data)) generated = fallbackResume(payload);
  } catch (error) {
    console.warn('Gemini resume provider failed; using the Laravel-compatible resume blueprint.', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    generated = fallbackResume(payload);
  }
  return withAtsBreakdown(generated);
}

export async function generateImprovedResume(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const generated = await generateJson<Record<string, unknown>>(buildImprovedResumePrompt(payload));
    if (!isRecord(generated.resume_data)) throw new Error('Gemini returned no resume data.');
    const resumeData = generated.resume_data;
    if (!isRecord(resumeData.personal_info)) resumeData.personal_info = {};
    if (!isRecord(resumeData.skills)) resumeData.skills = {};
    if (!Array.isArray(resumeData.work_experience)) resumeData.work_experience = [];
    if (!Array.isArray(resumeData.education)) resumeData.education = [];
    if (!Array.isArray(resumeData.languages)) resumeData.languages = [];
    if (!Array.isArray(resumeData.certifications)) resumeData.certifications = [];
    generated.resume_data = resumeData;
    return withAtsBreakdown(generated);
  } catch (error) {
    console.warn('Gemini resume-improvement provider failed.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown provider error.',
    });
    throw new ResumeImprovementError();
  }
}

function withAtsBreakdown(generated: Record<string, unknown>): Record<string, unknown> {
  const resumeData = isRecord(generated.resume_data) ? generated.resume_data : {};
  const personal = isRecord(resumeData.personal_info) ? resumeData.personal_info : {};
  const skills = isRecord(resumeData.skills) ? resumeData.skills : {};
  const experience = Array.isArray(resumeData.work_experience) ? resumeData.work_experience : [];
  const education = Array.isArray(resumeData.education) ? resumeData.education : [];
  const keywordCoverage = Math.min(25, (arrayLength(skills.hard_skills) * 3) + (arrayLength(skills.tools_technologies) * 2));
  const achievements = experience.reduce((count: number, item) => count + (isRecord(item) ? arrayLength(item.achievements) : 0), 0);
  const experienceStrength = Math.min(30, experience.length * 10 + achievements * 2);
  const structureQuality = (String(resumeData.summary || '').trim() ? 15 : 0)
    + (education.length ? 10 : 0)
    + (personal.email ? 5 : 0)
    + (personal.linkedin_url ? 5 : 0);
  const breakdown = {
    keyword_coverage: keywordCoverage,
    experience_strength: experienceStrength,
    structure_quality: structureQuality,
    formatting_readiness: 10,
  };
  const metaData = isRecord(generated.meta_data) ? generated.meta_data : {};
  metaData.ats_score_forecast = String(Math.min(100, keywordCoverage + experienceStrength + structureQuality + 10));
  metaData.ats_breakdown = breakdown;
  generated.meta_data = metaData;
  generated.resume_data = resumeData;
  return generated;
}

export async function getYoutubeResources(skill: string, language: string): Promise<Array<Record<string, string>>> {
  if (env.YOUTUBE_API_KEY) {
    try {
      const results = await getYoutubeApiResources(skill, language);
      if (results.length) return results;
    } catch (error) {
      console.warn('YouTube API provider failed; trying Gemini.', { name: error instanceof Error ? error.name : 'UnknownError' });
    }
  }

  if (env.GEMINI_API_KEY) {
    try {
      const videos = await generateJson<Array<Record<string, string>>>(`Provide a JSON array of 5 popular and high-quality YouTube video tutorials for learning '${skill}' in ${language}.
Prioritize videos that teach in ${language} or clearly support ${language}-speaking learners.
Each object should have:
- title: The video title
- video_id: The YouTube 11-character video ID
- duration: Approximate duration (e.g., '15 min')
- thumbnail: The standard YouTube thumbnail URL (https://img.youtube.com/vi/VIDEO_ID/hqdefault.jpg)

Return ONLY the valid JSON array.`);
      if (Array.isArray(videos)) {
        return videos.map((video, index) => ({
          id: String(index + 1),
          video_id: video.video_id || '',
          title: video.title || 'Tutorial',
          url: `https://www.youtube.com/watch?v=${video.video_id || ''}`,
          thumbnail: video.thumbnail || `https://img.youtube.com/vi/${video.video_id || ''}/hqdefault.jpg`,
          duration: video.duration || 'varies',
        }));
      }
    } catch (error) {
      console.warn('Gemini video provider failed; using fallback tutorials.', { name: error instanceof Error ? error.name : 'UnknownError' });
    }
  }

  return fallbackVideos(skill, language);
}

async function getYoutubeApiResources(skill: string, language: string): Promise<Array<Record<string, string>>> {
  if (!env.YOUTUBE_API_KEY) return [];
  const searchParams = new URLSearchParams({
    key: env.YOUTUBE_API_KEY,
    part: 'snippet',
    q: `${skill} tutorial ${language}`.trim(),
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '5',
    safeSearch: 'strict',
    relevanceLanguage: youtubeLanguageCode(language),
    order: 'relevance',
  });
  const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!searchResponse.ok) throw new Error(`YouTube search failed with status ${searchResponse.status}.`);
  const result = await searchResponse.json() as { items?: Array<{ id?: { videoId?: string } }> };
  const videoIds = (result.items || []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
  if (!videoIds.length) return [];

  const detailsParams = new URLSearchParams({
    key: env.YOUTUBE_API_KEY,
    part: 'contentDetails,snippet',
    id: videoIds.join(','),
  });
  const detailsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!detailsResponse.ok) throw new Error(`YouTube video details failed with status ${detailsResponse.status}.`);
  const details = await detailsResponse.json() as {
    items?: Array<{
      id?: string;
      snippet?: { title?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
      contentDetails?: { duration?: string };
    }>;
  };
  const detailsById = new Map((details.items || []).map((item) => [item.id, item]));
  return videoIds.flatMap((videoId, index) => {
    const video = detailsById.get(videoId);
    if (!video) return [];
    return [{
      id: String(index + 1),
      video_id: videoId,
      title: video.snippet?.title || 'Tutorial',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: formatYoutubeDuration(video.contentDetails?.duration || ''),
    }];
  });
}

function fallbackVideos(skill: string, language: string): Array<Record<string, string>> {
  return [
    {
      id: '1',
      video_id: 'Y6shV7S6WpU',
      title: `${skill} Full Course for Beginners (${language})`,
      url: 'https://www.youtube.com/watch?v=Y6shV7S6WpU',
      thumbnail: 'https://img.youtube.com/vi/Y6shV7S6WpU/hqdefault.jpg',
      duration: 'varies',
    },
    {
      id: '2',
      video_id: 'fBNz5xF-Kx4',
      title: `${skill} Advanced Tutorial (${language})`,
      url: 'https://www.youtube.com/watch?v=fBNz5xF-Kx4',
      thumbnail: 'https://img.youtube.com/vi/fBNz5xF-Kx4/hqdefault.jpg',
      duration: 'varies',
    },
  ];
}

function buildResumePrompt(payload: Record<string, unknown>): string {
  const rawInput = payload.raw_input || '';
  const targetRole = payload.target_role || '';
  const industry = payload.industry || '';
  const experienceLevel = payload.experience_level || '';
  const hasPhoto = payload.has_photo ? 'yes' : 'no';
  return `You are the "International Resume Architect," an elite AI career consultant and ATS optimization expert.

Core responsibilities:
1. Rewrite work experience bullets in STAR format.
2. Start every bullet with strong action verbs.
3. Quantify results. If metrics are missing, add realistic placeholders and clearly mark them like [ADD METRIC].
4. Optimize for keywords relevant to the candidate's target role.
5. If photo is present, generate image-processing instructions to remove background, replace with solid #FFFFFF or #F0F8FF, center the face, and adjust contrast.
6. Select the best template ID from:
- TEMPL_CLASSIC_SERIF
- TEMPL_TECH_MINIMAL
- TEMPL_CREATIVE_MODERN
- TEMPL_EXECUTIVE_BOLD
- TEMPL_GLOBAL_PRO

Return ONLY a valid JSON object with this shape:
{
  "meta_data": {"recommended_template_id": "", "ats_score_forecast": "1-100", "image_processing_directive": null},
  "resume_data": {
    "personal_info": {"full_name": "", "professional_title": "", "email": "", "phone": "", "linkedin_url": "", "location": "City, Country", "photo_url_placeholder": "processed_photo.jpg"},
    "summary": "",
    "skills": {"hard_skills": [], "soft_skills": [], "tools_technologies": []},
    "work_experience": [{"company": "", "role": "", "location": "", "duration": "", "achievements": []}],
    "education": [{"degree": "", "institution": "", "year": "", "gpa_or_honors": ""}],
    "languages": [],
    "certifications": []
  }
}

Candidate target role: ${targetRole}
Candidate industry: ${industry}
Experience level: ${experienceLevel}
Photo provided: ${hasPhoto}

Input Data to Process:
${rawInput}`;
}

function buildImprovedResumePrompt(payload: Record<string, unknown>): string {
  const list = (value: unknown) => Array.isArray(value) ? value.join(', ') : '';
  return `You are the "International Resume Architect," an elite AI career consultant and ATS optimization expert.

Task:
1. Analyze the candidate's EXISTING resume text.
2. Find weaknesses against the target role.
3. Rewrite the entire resume into a stronger ATS-optimized international standard version.
4. Rewrite work experience bullets using STAR format.
5. Start bullets with strong action verbs and use quantified placeholders like [ADD METRIC] where exact numbers are missing.
6. Never invent candidate names, employers, job titles, dates, education, certifications, technologies, or achievements. Preserve facts from the source; mark a missing metric as [ADD METRIC] rather than inventing a number.
7. Optimize for the target role and required keywords.
8. Return a concise evidence-based skill-gap analysis in metadata in the same response.
9. If a photo is present, provide image-processing instructions to remove the background, use #FFFFFF or #F0F8FF, center the face, and adjust contrast.
10. Choose the best template from:
- TEMPL_CLASSIC_SERIF
- TEMPL_TECH_MINIMAL
- TEMPL_CREATIVE_MODERN
- TEMPL_EXECUTIVE_BOLD
- TEMPL_GLOBAL_PRO

Return ONLY a valid JSON object with this structure:
{
  "meta_data": {"recommended_template_id": "", "ats_score_forecast": "1-100", "image_processing_directive": null, "improvement_focus": [], "ats_keywords": [], "current_skills": [], "required_skills": [], "identified_skill_gaps": []},
  "resume_data": {
    "personal_info": {"full_name": "", "professional_title": "", "email": "", "phone": "", "linkedin_url": "", "location": "City, Country format", "photo_url_placeholder": "processed_photo.jpg"},
    "summary": "",
    "skills": {"hard_skills": [], "soft_skills": [], "tools_technologies": []},
    "work_experience": [],
    "education": [],
    "languages": [],
    "certifications": []
  }
}

Target Role: ${payload.target_role || ''}
Industry: ${payload.industry || ''}
Experience Level: ${payload.experience_level || ''}
Current Skills Found: ${list(payload.current_skills)}
Required Skills: ${list(payload.required_skills)}
Skill Gaps: ${list(payload.skill_gaps)}
Extra Instruction: ${payload.prompt || ''}
Photo provided: ${payload.has_photo ? 'yes' : 'no'}

Existing Resume Text:
${String(payload.raw_resume_text || '').slice(0, 24000)}`;
}

function fallbackResume(payload: Record<string, unknown>): Record<string, unknown> {
  const targetRole = String(payload.target_role || 'Professional Candidate');
  const industry = String(payload.industry || 'General');
  const experienceLevel = String(payload.experience_level || 'Mid-Level');
  const hasPhoto = Boolean(payload.has_photo);
  const search = `${industry} ${targetRole} ${experienceLevel}`.toLowerCase();
  const template = search.includes('finance') || search.includes('law') ? 'TEMPL_CLASSIC_SERIF'
    : search.includes('software') || search.includes('data') || search.includes('developer') ? 'TEMPL_TECH_MINIMAL'
      : search.includes('design') || search.includes('marketing') || search.includes('media') ? 'TEMPL_CREATIVE_MODERN'
        : search.includes('director') || search.includes('executive') || search.includes('c-suite') ? 'TEMPL_EXECUTIVE_BOLD'
          : 'TEMPL_GLOBAL_PRO';
  return {
    meta_data: {
      recommended_template_id: template,
      ats_score_forecast: '78',
      image_processing_directive: hasPhoto
        ? 'Remove existing background, replace with solid #FFFFFF or #F0F8FF, center face, and adjust contrast.'
        : null,
    },
    resume_data: {
      personal_info: {
        full_name: '',
        professional_title: targetRole,
        email: '',
        phone: '',
        linkedin_url: '',
        location: 'City, Country',
        photo_url_placeholder: 'processed_photo.jpg',
      },
      summary: `Results-driven ${targetRole} candidate with ${experienceLevel} experience in ${industry}. Delivers structured execution, measurable outcomes, and ATS-aligned positioning for international opportunities.`,
      skills: {
        hard_skills: [targetRole, 'Problem Solving', 'Process Improvement'],
        soft_skills: ['Communication', 'Leadership', 'Collaboration'],
        tools_technologies: ['Excel', 'Google Workspace', 'Project Tracking Tools'],
      },
      work_experience: [{
        company: 'Previous Employer',
        role: targetRole,
        location: 'City, Country',
        duration: 'Jan 2022 – Present',
        achievements: [
          `Spearheaded core ${targetRole} initiatives to improve delivery speed by [ADD METRIC], aligning execution with business goals.`,
          'Optimized daily workflows by introducing structured processes, reducing manual effort by [ADD METRIC] and improving team productivity.',
        ],
      }],
      education: [{ degree: 'Bachelor Degree', institution: 'University Name', year: '2024', gpa_or_honors: '' }],
      languages: ['English (Professional Working Proficiency)'],
      certifications: [],
    },
  };
}

function youtubeLanguageCode(language: string): string {
  const codes: Record<string, string> = { urdu: 'ur', hindi: 'hi', arabic: 'ar', turkish: 'tr' };
  return codes[language.toLowerCase()] || 'en';
}

function formatYoutubeDuration(value: string): string {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 'varies';
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  if (hours > 0) return `${hours} hr${minutes > 0 ? ` ${minutes} min` : ''}`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.max(1, seconds)} sec`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

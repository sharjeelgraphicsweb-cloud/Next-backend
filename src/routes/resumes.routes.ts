import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import PDFDocument from 'pdfkit';
import pdfParse from 'pdf-parse';
import { Document as WordDocument, Packer, Paragraph, TextRun } from 'docx';
import { ObjectId } from 'mongodb';
import { generateImprovedResume, generateResume } from '../services/gemini';
import { collection, mongoId } from '../data/mongo';
import { AuthenticatedRequest } from '../middleware/auth';
import { env } from '../config/env';
import { imageUpload, publicUploadUrl, resumePdfUpload, resumePhotoUpload, uploadDirectory } from '../middleware/uploads';

const router = Router();

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const resumes = await collection('resumes').find({ user_id: req.user.id }).sort({ updated_at: -1 }).toArray();
    return res.json(resumes.map(serialize));
  } catch (error) {
    return next(error);
  }
});

router.post('/generate', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  if (prompt.length < 10 || prompt.length > 5000) {
    return res.status(422).json({ message: 'Validation error', errors: { prompt: ['The prompt must be between 10 and 5000 characters.'] } });
  }
  const optionalFields = ['target_role', 'industry', 'experience_level'] as const;
  for (const field of optionalFields) {
    if (req.body?.[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length > 255)) {
      return res.status(422).json({ message: 'Validation error', errors: { [field]: [`The ${field} must be a string of at most 255 characters.`] } });
    }
  }
  if (req.body?.raw_input !== undefined && (typeof req.body.raw_input !== 'string' || req.body.raw_input.length > 12000)) {
    return res.status(422).json({ message: 'Validation error', errors: { raw_input: ['The raw_input may not exceed 12000 characters.'] } });
  }
  if (req.body?.has_photo !== undefined && ![true, false, 0, 1, '0', '1'].includes(req.body.has_photo)) {
    return res.status(422).json({ message: 'Validation error', errors: { has_photo: ['The has_photo field must be true or false.'] } });
  }
  try {
    const user = await collection('users').findOne({ _id: mongoId(req.user.id) });
    if (!user) return res.status(401).json({ message: 'Unauthenticated' });
    const input = {
      prompt,
      target_role: optionalString(req.body?.target_role),
      industry: optionalString(req.body?.industry),
      experience_level: optionalString(req.body?.experience_level),
      raw_input: optionalString(req.body?.raw_input) || prompt,
      has_photo: Boolean(req.body?.has_photo === true || req.body?.has_photo === 1 || req.body?.has_photo === '1' || user.avatar),
      user_name: user.name,
      user_email: user.email,
    };
    const generated = await generateResume(input);
    if (!isRecord(generated.resume_data)) throw new Error('Resume generation returned no resume_data.');
    const resumeData = generated.resume_data;
    const personalInfo = isRecord(resumeData.personal_info) ? resumeData.personal_info : {};
    if (user.avatar) personalInfo.photo_url_placeholder = user.avatar;
    resumeData.personal_info = personalInfo;
    const now = new Date();
    const resume = {
      user_id: req.user.id,
      title: String(personalInfo.professional_title || input.target_role || 'Professional Resume'),
      target_role: input.target_role || String(personalInfo.professional_title || 'Professional Resume'),
      industry: input.industry || null,
      experience_level: input.experience_level || null,
      raw_prompt: prompt,
      raw_input: input.raw_input,
      photo_url: user.avatar || null,
      meta_data: isRecord(generated.meta_data) ? generated.meta_data : {},
      resume_data: resumeData,
      created_at: now,
      updated_at: now,
    };
    const result = await collection('resumes').insertOne(resume);
    await syncUserProfile(req.user.id, resumeData);
    return res.status(201).json(serialize({ ...resume, _id: result.insertedId }));
  } catch (error) {
    return next(error);
  }
});

router.post('/improve-existing', resumePdfUpload.single('resume'), async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const targetRole = String(req.body?.target_role || '');
  if (!req.file || !targetRole || targetRole.length > 255) {
    if (req.file) await removeUploaded(req.file.path);
    return res.status(422).json({ message: 'Validation error', errors: { resume: ['A PDF resume and target_role are required.'] } });
  }
  if (req.body?.prompt !== undefined && (typeof req.body.prompt !== 'string' || req.body.prompt.length > 5000)) {
    await removeUploaded(req.file.path);
    return res.status(422).json({ message: 'Validation error', errors: { prompt: ['The prompt may not exceed 5000 characters.'] } });
  }

  try {
    const parsed = await pdfParse(await fs.readFile(req.file.path));
    const resumeText = parsed.text.trim();
    await removeUploaded(req.file.path);
    if (!resumeText) return res.status(422).json({ message: 'Could not extract text from the uploaded resume' });
    const user = await collection('users').findOne({ _id: mongoId(req.user.id) });
    if (!user) return res.status(401).json({ message: 'Unauthenticated' });

    const prompt = String(req.body?.prompt || `Improve this existing resume for the role of ${targetRole}`);
    const industry = optionalString(req.body?.industry) || '';
    const experienceLevel = optionalString(req.body?.experience_level) || '';
    const generated = await generateImprovedResume({
      prompt,
      target_role: targetRole,
      industry,
      experience_level: experienceLevel,
      raw_resume_text: resumeText,
      has_photo: Boolean(user.avatar),
    });
    if (!isRecord(generated.resume_data)) throw new Error('Resume improvement returned no resume_data.');

    const resumeData = generated.resume_data;
    const personalInfo = isRecord(resumeData.personal_info) ? resumeData.personal_info : {};
    if (user.avatar) personalInfo.photo_url_placeholder = user.avatar;
    resumeData.personal_info = personalInfo;
    const metaData = isRecord(generated.meta_data) ? generated.meta_data : {};
    const analysis = {
      current_skills: stringArray(metaData.current_skills),
      required_skills: stringArray(metaData.required_skills),
      skill_gaps: stringArray(metaData.identified_skill_gaps),
    };
    metaData.improvement_mode = 'existing_resume_upgrade';
    const now = new Date();
    const record = {
      user_id: req.user.id,
      title: String(personalInfo.professional_title || targetRole),
      target_role: targetRole,
      industry: industry || null,
      experience_level: experienceLevel || null,
      raw_prompt: prompt,
      raw_input: resumeText,
      photo_url: user.avatar || null,
      meta_data: metaData,
      resume_data: resumeData,
      created_at: now,
      updated_at: now,
    };
    const result = await collection('resumes').insertOne(record);
    await syncUserProfile(req.user.id, resumeData);
    return res.status(201).json({ resume: serialize({ ...record, _id: result.insertedId }), gap_analysis: analysis });
  } catch (error) {
    if (req.file) await removeUploaded(req.file.path);
    return next(error);
  }
});

router.get('/:id/download', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const resume = await collection('resumes').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!resume) return res.status(404).json({ message: 'Resume not found' });
    const format = String(req.query.format || 'pdf').toLowerCase();
    const filenameBase = String(resume.target_role || 'resume').trim().replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80) || 'resume';
    if (format === 'docx') {
      const buffer = await createDocxBuffer(resume);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}_resume.docx"`);
      return res.send(buffer);
    }
    const resumeData = isRecord(resume.resume_data) ? resume.resume_data : {};
    const personalInfo = isRecord(resumeData.personal_info) ? resumeData.personal_info : {};
    const photo = await readUploadedResumePhoto(resume.photo_url || personalInfo.photo_url_placeholder);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}_resume.pdf"`);
    const pdf = new PDFDocument({ size: 'A4', margin: 42 });
    pdf.pipe(res);
    writeResumePdf(pdf, resume, photo);
    pdf.end();
    return;
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/photo', resumePhotoUpload.single('image'), async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (!req.file) return res.status(422).json({ message: 'Validation error', errors: { image: ['An image file is required.'] } });
  try {
    const resume = await collection('resumes').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!resume) {
      await removeUploaded(req.file.path);
      return res.status(404).json({ message: 'Resume not found' });
    }
    const photoUrl = publicUploadUrl(req.file.filename);
    const metaData = isRecord(resume.meta_data) ? resume.meta_data : {};
    const resumeData = isRecord(resume.resume_data) ? resume.resume_data : {};
    const personalInfo = isRecord(resumeData.personal_info) ? resumeData.personal_info : {};
    personalInfo.photo_url_placeholder = photoUrl;
    resumeData.personal_info = personalInfo;
    metaData.image_processing_directive = 'Remove background, replace it with a solid #FFFFFF or #F0F8FF background, center the face, and adjust contrast.';
    await collection('resumes').updateOne({ _id: resume._id }, { $set: { photo_url: photoUrl, meta_data: metaData, resume_data: resumeData, updated_at: new Date() } });
    const updated = await collection('resumes').findOne({ _id: resume._id });
    return res.json(updated ? serialize(updated) : null);
  } catch (error) {
    await removeUploaded(req.file.path);
    return next(error);
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const resume = await collection('resumes').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!resume) return res.status(404).json({ message: 'Resume not found' });
    return res.json(serialize(resume));
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const allowed = ['title', 'target_role', 'industry', 'experience_level', 'meta_data', 'resume_data'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = req.body?.[key];
    if (value === undefined) continue;
    if (['meta_data', 'resume_data'].includes(key) && value !== null && !isRecord(value) && !Array.isArray(value)) {
      return res.status(422).json({ message: 'Validation error', errors: { [key]: [`The ${key} field must be an array.`] } });
    }
    if (['title', 'target_role', 'industry', 'experience_level'].includes(key) &&
        value !== null && (typeof value !== 'string' || value.length > 255)) {
      return res.status(422).json({ message: 'Validation error', errors: { [key]: [`The ${key} field must be a string of at most 255 characters.`] } });
    }
    updates[key] = value;
  }
  if (Object.keys(updates).length === 0) return res.status(422).json({ message: 'No valid resume fields were provided.' });
  try {
    const result = await collection('resumes').updateOne(
      { _id: mongoId(req.params.id), user_id: req.user.id },
      { $set: { ...updates, updated_at: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Resume not found' });
    const updated = await collection('resumes').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    return res.json(updated ? serialize(updated) : null);
  } catch (error) {
    return next(error);
  }
});

async function syncUserProfile(userId: string, resumeData: Record<string, any>): Promise<void> {
  const personalInfo = isRecord(resumeData.personal_info) ? resumeData.personal_info : {};
  const skills = isRecord(resumeData.skills) ? resumeData.skills : {};
  const allSkills = [...(skills.hard_skills || []), ...(skills.tools_technologies || []), ...(skills.soft_skills || [])]
    .filter((skill): skill is string => typeof skill === 'string');
  const domain = personalInfo.professional_title || resumeData.summary;
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (domain) updates.domain = domain;
  if (allSkills.length) updates.skills = [...new Set(allSkills)];
  await collection('users').updateOne({ _id: mongoId(userId) }, { $set: updates });
}

function writeResumePdf(pdf: InstanceType<typeof PDFDocument>, resume: Record<string, any>, photo: Buffer | null): void {
  const data = isRecord(resume.resume_data) ? resume.resume_data : {};
  const personal = isRecord(data.personal_info) ? data.personal_info : {};
  const pageWidth = pdf.page.width;
  const headerHeight = 148;
  const photoSize = photo ? 82 : 0;
  const textWidth = pageWidth - 84 - (photo ? 110 : 0);
  const name = String(personal.full_name || 'Professional Candidate');
  const title = String(personal.professional_title || resume.target_role || 'Professional Resume');

  pdf.save().rect(0, 0, pageWidth, headerHeight).fill('#14243A').restore();
  pdf.save().rect(0, 0, 8, headerHeight).fill('#20A6A6').restore();
  pdf.font('Helvetica-Bold').fontSize(25).fillColor('#FFFFFF')
    .text(name, 42, 31, { width: textWidth, lineBreak: false, ellipsis: true });
  pdf.font('Helvetica').fontSize(12).fillColor('#8FE0D5')
    .text(title, 42, 65, { width: textWidth, lineBreak: false, ellipsis: true });

  const contactLines = [
    [personal.email, personal.phone, personal.location],
    [personal.linkedin_url, personal.website, personal.portfolio_url],
  ];
  let contactY = 94;
  for (const line of contactLines) {
    const text = line.filter((value) => typeof value === 'string' && value.trim()).join('  |  ');
    if (!text) continue;
    pdf.font('Helvetica').fontSize(8.5).fillColor('#E4ECF4')
      .text(text, 42, contactY, { width: textWidth, lineBreak: false, ellipsis: true });
    contactY += 15;
  }

  if (photo) {
    const photoX = pageWidth - 42 - photoSize;
    const photoY = 31;
    pdf.save().circle(photoX + photoSize / 2, photoY + photoSize / 2, photoSize / 2).clip();
    pdf.image(photo, photoX, photoY, { fit: [photoSize, photoSize], align: 'center', valign: 'center' });
    pdf.restore();
    pdf.lineWidth(3).strokeColor('#8FE0D5')
      .circle(photoX + photoSize / 2, photoY + photoSize / 2, photoSize / 2).stroke();
  }

  pdf.save().rect(8, headerHeight - 4, pageWidth - 8, 4).fill('#20A6A6').restore();
  pdf.y = headerHeight + 24;

  addResumeSectionHeading(pdf, 'Professional Summary', name, title);
  const summary = String(data.summary || '').trim();
  if (summary) {
    pdf.font('Helvetica').fontSize(9.5).fillColor('#344054')
      .text(summary, { width: pageWidth - 84, lineGap: 3 });
  }

  const skills = isRecord(data.skills) ? data.skills : {};
  const skillGroups = [
    ['Core Skills', skills.hard_skills],
    ['Tools & Technologies', skills.tools_technologies],
    ['Professional Strengths', skills.soft_skills],
  ] as const;
  const allSkills = skillGroups.flatMap(([, values]) => Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (allSkills.length) {
    addResumeSectionHeading(pdf, 'Skills', name, title);
    let chipX = 42;
    let chipY = pdf.y;
    for (const skill of allSkills) {
      const label = skill.trim();
      const chipWidth = pdf.font('Helvetica').fontSize(8.5).widthOfString(label) + 18;
      if (chipX + chipWidth > pageWidth - 42) {
        chipX = 42;
        chipY += 25;
      }
      if (chipY + 21 > pdf.page.height - 42) {
        ensureResumePdfSpace(pdf, 21, name, title);
        chipY = pdf.y;
        chipX = 42;
      }
      pdf.save().roundedRect(chipX, chipY, chipWidth, 19, 7).fill('#EEF6F7').restore();
      pdf.font('Helvetica').fontSize(8.5).fillColor('#24545A')
        .text(label, chipX + 9, chipY + 5, { lineBreak: false });
      chipX += chipWidth + 7;
    }
    pdf.y = chipY + 30;
  }

  const experience = Array.isArray(data.work_experience) ? data.work_experience : [];
  if (experience.length) {
    addResumeSectionHeading(pdf, 'Professional Experience', name, title);
    for (const item of experience) {
      if (!isRecord(item)) continue;
      const role = [item.role, item.company].filter(Boolean).map(String).join('  |  ');
      const details = [item.location, item.duration].filter(Boolean).map(String).join('  |  ');
      ensureResumePdfSpace(pdf, 44, name, title);
      pdf.font('Helvetica-Bold').fontSize(10).fillColor('#14243A')
        .text(role || 'Experience', 42, pdf.y, { width: pageWidth - 84 });
      pdf.moveDown(0.15);
      if (details) {
        pdf.font('Helvetica').fontSize(8.5).fillColor('#667085')
          .text(details, { width: pageWidth - 84 });
      }
      pdf.moveDown(0.25);
      const achievements = Array.isArray(item.achievements) ? item.achievements : [];
      for (const achievement of achievements) {
        if (typeof achievement !== 'string' || !achievement.trim()) continue;
        ensureResumePdfSpace(pdf, 24, name, title);
        const bulletY = pdf.y + 5;
        pdf.save().circle(48, bulletY, 2).fill('#20A6A6').restore();
        pdf.font('Helvetica').fontSize(9).fillColor('#344054')
          .text(achievement.trim(), 58, pdf.y, { width: pageWidth - 100, lineGap: 2 });
        pdf.moveDown(0.2);
      }
      pdf.moveDown(0.35);
    }
  }

  const education = Array.isArray(data.education) ? data.education : [];
  if (education.length) {
    addResumeSectionHeading(pdf, 'Education', name, title);
    for (const item of education) {
      if (!isRecord(item)) continue;
      const heading = [item.degree, item.institution].filter(Boolean).map(String).join('  |  ');
      const details = [item.location, item.year, item.gpa_or_honors].filter(Boolean).map(String).join('  |  ');
      ensureResumePdfSpace(pdf, 38, name, title);
      pdf.font('Helvetica-Bold').fontSize(9.5).fillColor('#14243A')
        .text(heading || 'Education', { width: pageWidth - 84 });
      if (details) {
        pdf.font('Helvetica').fontSize(8.5).fillColor('#667085')
          .text(details, { width: pageWidth - 84 });
      }
      pdf.moveDown(0.45);
    }
  }

  addResumeListSection(pdf, 'Certifications', data.certifications, name, title);
  addResumeListSection(pdf, 'Languages', data.languages, name, title);
}

function addResumeSectionHeading(
  pdf: InstanceType<typeof PDFDocument>,
  title: string,
  name: string,
  role: string,
): void {
  ensureResumePdfSpace(pdf, 32, name, role);
  const y = pdf.y;
  pdf.font('Helvetica-Bold').fontSize(10).fillColor('#14243A')
    .text(title.toUpperCase(), 42, y, { characterSpacing: 0.7 });
  pdf.save().moveTo(42, y + 18).lineTo(pdf.page.width - 42, y + 18)
    .lineWidth(0.8).strokeColor('#DCE5EB').stroke().restore();
  pdf.save().moveTo(42, y + 18).lineTo(86, y + 18)
    .lineWidth(2).strokeColor('#20A6A6').stroke().restore();
  pdf.y = y + 28;
}

function addResumeListSection(
  pdf: InstanceType<typeof PDFDocument>,
  title: string,
  values: unknown,
  name: string,
  role: string,
): void {
  const items = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (!items.length) return;
  addResumeSectionHeading(pdf, title, name, role);
  for (const item of items) {
    ensureResumePdfSpace(pdf, 22, name, role);
    pdf.font('Helvetica').fontSize(9).fillColor('#344054')
      .text(item, { width: pdf.page.width - 84, lineGap: 2 });
    pdf.moveDown(0.2);
  }
}

function ensureResumePdfSpace(
  pdf: InstanceType<typeof PDFDocument>,
  needed: number,
  name: string,
  role: string,
): void {
  if (pdf.y + needed <= pdf.page.height - 42) return;
  pdf.addPage();
  pdf.save().rect(0, 0, pdf.page.width, 5).fill('#20A6A6').restore();
  pdf.font('Helvetica-Bold').fontSize(9).fillColor('#14243A')
    .text(name, 42, 20, { width: pdf.page.width - 84, lineBreak: false, ellipsis: true });
  if (role) {
    pdf.font('Helvetica').fontSize(8).fillColor('#667085')
      .text(role, 42, 34, { width: pdf.page.width - 84, lineBreak: false, ellipsis: true });
  }
  pdf.save().moveTo(42, 52).lineTo(pdf.page.width - 42, 52)
    .lineWidth(0.8).strokeColor('#DCE5EB').stroke().restore();
  pdf.y = 65;
}

async function readUploadedResumePhoto(value: unknown): Promise<Buffer | null> {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const baseUrl = new URL(env.BACKEND_PUBLIC_URL);
    const photoUrl = new URL(value, baseUrl);
    if (photoUrl.origin !== baseUrl.origin || !photoUrl.pathname.startsWith('/uploads/')) return null;
    const filename = decodeURIComponent(path.basename(photoUrl.pathname));
    if (!/^\d+-[a-f0-9]{16}\.(?:jpe?g|png)$/i.test(filename)) return null;
    try {
      return await fs.readFile(path.join(uploadDirectory, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof URIError) return null;
    throw error;
  }
}

async function createDocxBuffer(resume: Record<string, any>): Promise<Buffer> {
  const data = isRecord(resume.resume_data) ? resume.resume_data : {};
  const personal = isRecord(data.personal_info) ? data.personal_info : {};
  const skills = isRecord(data.skills) ? data.skills : {};
  const children: Paragraph[] = [
    new Paragraph({ alignment: 'center', children: [new TextRun({ text: String(personal.full_name || 'Professional Candidate'), bold: true, size: 36 })] }),
    new Paragraph({ alignment: 'center', text: String(personal.professional_title || resume.target_role || 'Professional Resume') }),
    new Paragraph({ alignment: 'center', text: [personal.email, personal.phone, personal.linkedin_url].filter(Boolean).join(' | ') }),
    makeSection('Professional Summary', [data.summary]),
    makeSection('Skills', [...(skills.hard_skills || []), ...(skills.tools_technologies || []), ...(skills.soft_skills || [])]),
    makeSection('Experience', (data.work_experience || []).flatMap((item: Record<string, any>) => [`${item.role || ''} - ${item.company || ''}`, ...(item.achievements || [])])),
    makeSection('Education', (data.education || []).map((item: Record<string, any>) => `${item.degree || ''} - ${item.institution || ''} ${item.year || ''}`)),
  ];
  const document = new WordDocument({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

function makeSection(title: string, items: unknown[]): Paragraph {
  const content = items.map(String).filter((item) => item.trim()).join('\n');
  return new Paragraph({ children: [new TextRun({ text: `\n${title}\n`, bold: true }), new TextRun(content)] });
}

function serialize(document: Record<string, any>): Record<string, any> {
  const id = document._id instanceof ObjectId ? document._id.toString() : String(document._id);
  return { ...document, _id: id, id };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function removeUploaded(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export default router;

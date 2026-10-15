import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  AlignmentType,
  Document as WordDocument,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { randomBytes } from 'crypto';
import { env } from '../config/env';
import { collection, findById, mongoId } from '../data/mongo';
import { awardXp } from '../data/stats';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

const router = Router();

router.get('/verify/:id', async (req, res, next) => {
  try {
    const certificate = await collection('certificates').findOne({ certificate_code: req.params.id });
    if (!certificate) return res.status(404).json({ valid: false, message: 'Certificate not found' });
    const [roadmap, user] = await Promise.all([
      findById('roadmaps', String(certificate.roadmap_id)),
      findById('users', String(certificate.user_id)),
    ]);
    return res.json({
      valid: true,
      certificate: {
        id: certificate._id.toString(),
        code: certificate.certificate_code,
        issued_at: certificate.issued_at,
        target_role: roadmap?.target_role || 'Unknown',
        user_name: user?.name || 'Unknown',
        roadmap_name: roadmap?.target_role || 'Unknown',
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const certificates = await collection('certificates').find({ user_id: req.user.id }).sort({ issued_at: -1 }).toArray();
    const data = await Promise.all(certificates.map(async (certificate) => {
      const roadmap = await findById('roadmaps', String(certificate.roadmap_id));
      return { ...serialize(certificate), roadmap: roadmap ? serialize(roadmap) : null };
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/generate/:roadmapId', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const roadmap = await collection('roadmaps').findOne({ _id: mongoId(req.params.roadmapId), user_id: req.user.id });
    if (!roadmap) return res.status(404).json({ message: 'Roadmap not found' });

    const existing = await collection('certificates').findOne({ user_id: req.user.id, roadmap_id: req.params.roadmapId });
    if (existing) {
      const associatedRoadmap = await findById('roadmaps', String(existing.roadmap_id));
      return res.json({ success: true, data: { ...serialize(existing), roadmap: associatedRoadmap ? serialize(associatedRoadmap) : null } });
    }

    const progress = await collection('progress').findOne({ user_id: req.user.id, roadmap_id: req.params.roadmapId });
    const completedNodes: string[] = (progress?.completed_nodes || []).map(String);
    const allNodeIds = (roadmap.nodes || []).map((node: Record<string, any>) => String(node.id));
    if (!progress || allNodeIds.some((nodeId: string) => !completedNodes.includes(nodeId))) {
      return res.status(400).json({
        message: 'Cannot generate certificate. Roadmap is not yet completed.',
        completed_nodes: completedNodes.length,
        total_nodes: allNodeIds.length,
      });
    }

    const now = new Date();
    const certificate = {
      user_id: req.user.id,
      roadmap_id: req.params.roadmapId,
      certificate_code: randomBytes(8).toString('hex').slice(0, 12).toUpperCase(),
      issued_at: now,
      created_at: now,
      updated_at: now,
    };
    const inserted = await collection('certificates').insertOne(certificate);
    await awardXp(req.user.id, 100);
    await collection('user_stats').updateOne(
      { user_id: req.user.id },
      { $setOnInsert: { user_id: req.user.id, level: 1, streak: 0 }, $addToSet: { badges: `Certified: ${roadmap.target_role}` } },
      { upsert: true },
    );
    return res.status(201).json({ success: true, data: { ...serialize({ ...certificate, _id: inserted.insertedId }), roadmap: serialize(roadmap) } });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/download', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const certificate = await collection('certificates').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!certificate) return res.status(404).json({ message: 'Certificate not found' });
    const [user, roadmap] = await Promise.all([
      findById('users', String(certificate.user_id)),
      findById('roadmaps', String(certificate.roadmap_id)),
    ]);
    const logo = await fs.readFile(path.resolve(__dirname, '../../public/nextsteplogo.png'));
    const format = String(req.query.format || 'pdf');
    const code = String(certificate.certificate_code);
    const fileName = `Certificate_${code}.${format === 'docx' ? 'docx' : 'pdf'}`;
    const verificationUrl = `${env.FRONTEND_URL.replace(/\/+$/, '')}/certificates/verify/${encodeURIComponent(code)}`;
    const qrCode = await QRCode.toBuffer(verificationUrl, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 240,
      color: { dark: '#3e4a55', light: '#ffffff' },
    });
    const details = {
      userName: String(user?.name || 'Learner'),
      targetRole: String(roadmap?.target_role || 'Professional'),
      issuedAt: new Date(certificate.issued_at).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }),
      code,
    };

    if (format === 'docx') {
      const document = new WordDocument({
        sections: [{
          properties: {
            page: {
              size: { orientation: 'landscape' },
              margin: { top: 360, right: 360, bottom: 360, left: 360 },
            },
          },
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              columnWidths: [63, 37],
              rows: [
                new TableRow({
                  height: { value: 9000, rule: 'atLeast' },
                  children: [
                    new TableCell({
                      width: { size: 63, type: WidthType.PERCENTAGE },
                      margins: { top: 300, right: 420, bottom: 300, left: 420 },
                      children: [
                        new Paragraph({
                          children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 120, height: 82 } })],
                        }),
                        new Paragraph({ spacing: { before: 300, after: 350 }, children: [new TextRun({ text: details.issuedAt, size: 20, color: '6A7681' })] }),
                        new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: details.userName, font: 'Georgia', size: 42, color: '3E4A55' })] }),
                        new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: 'has successfully completed', size: 20, color: '8C98A3' })] }),
                        new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: details.targetRole, font: 'Georgia', size: 30, color: '55616D' })] }),
                        new Paragraph({
                          spacing: { after: 500 },
                          children: [new TextRun({
                            text: 'an online professional learning roadmap offered by NextStep AI',
                            size: 18,
                            color: '8C98A3',
                          })],
                        }),
                        new Paragraph({
                          spacing: { before: 450 },
                          children: [new TextRun({ text: 'NextStep AI Team', font: 'Georgia', italics: true, size: 24, color: '3E4A55' })],
                        }),
                        new Paragraph({ children: [new TextRun({ text: 'Platform Director', size: 16, color: '8C98A3' })] }),
                      ],
                    }),
                    new TableCell({
                      width: { size: 37, type: WidthType.PERCENTAGE },
                      shading: { fill: 'D8DEE6', type: ShadingType.CLEAR },
                      margins: { top: 800, right: 260, bottom: 300, left: 260 },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          spacing: { after: 550 },
                          children: [new TextRun({ text: 'ROADMAP\\nCERTIFICATE', bold: true, size: 28, color: '3E4A55' })],
                        }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new ImageRun({ type: 'png', data: qrCode, transformation: { width: 120, height: 120 } })],
                        }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          spacing: { before: 350, after: 150 },
                          children: [new TextRun({ text: 'SCAN TO VERIFY', bold: true, size: 16, color: '3E4A55' })],
                        }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: `VERIFICATION ID: ${details.code}`, size: 14, color: '3E4A55' })],
                        }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          spacing: { before: 160 },
                          children: [new TextRun({ text: verificationUrl, size: 12, color: '3E63B6' })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }],
      });
      const buffer = await Packer.toBuffer(document);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(buffer);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    pdf.pipe(res);

    const { width, height } = pdf.page;
    const bannerX = width * 0.60;
    const bannerWidth = width * 0.25;
    const description = `For the successful completion of the ${details.targetRole} professional learning roadmap and demonstrating commitment to continuous professional growth in the field of technology.`;

    pdf.rect(0, 0, width, height).fill('#ffffff');
    pdf.save();
    pdf.strokeColor('#f8f8f8').lineWidth(0.3);
    for (let x = 0; x <= width; x += 25) pdf.moveTo(x, 0).lineTo(x, height);
    for (let y = 0; y <= height; y += 25) pdf.moveTo(0, y).lineTo(width, y);
    pdf.stroke().restore();

    pdf.fillColor('#d8dee6')
      .moveTo(bannerX, 0).lineTo(bannerX + bannerWidth, 0)
      .lineTo(bannerX + bannerWidth, height).lineTo(bannerX, height - 35)
      .closePath().fill();

    pdf.lineWidth(1.5).strokeColor('#cccccc').rect(17, 17, width - 34, height - 34).stroke();
    for (const [x, y] of [[17, 17], [width - 27, 17], [17, height - 27], [width - 27, height - 27]]) {
      pdf.fillColor('#ffffff').lineWidth(1.2).strokeColor('#cccccc').rect(x, y, 10, 10).fillAndStroke();
    }

    const contentLeft = 67;
    const leftWidth = bannerX - contentLeft - 24;
    pdf.image(logo, contentLeft, 48, { fit: [135, 82], valign: 'center' });
    pdf.font('Helvetica').fontSize(10).fillColor('#6a7681')
      .text(details.issuedAt, contentLeft, 153, { width: leftWidth });
    pdf.font('Helvetica').fontSize(10).fillColor('#8c98a3')
      .text('CERTIFICATE OF COMPLETION', contentLeft, 180, { width: leftWidth, characterSpacing: 1.2 });
    pdf.font('Times-Roman').fontSize(28).fillColor('#3e4a55')
      .text(details.userName, contentLeft, 205, { width: leftWidth, lineBreak: false, ellipsis: true });
    pdf.font('Helvetica').fontSize(11).fillColor('#8c98a3')
      .text('has successfully completed', contentLeft, 251, { width: leftWidth });
    pdf.font('Times-Roman').fontSize(19).fillColor('#55616d')
      .text(details.targetRole, contentLeft, 275, { width: leftWidth, lineGap: 2 });
    pdf.font('Helvetica').fontSize(10).fillColor('#8c98a3')
      .text('an online professional learning roadmap offered through NextStep AI', contentLeft, 333, {
        width: leftWidth,
        lineGap: 3,
      });

    pdf.image(qrCode, bannerX + (bannerWidth - 105) / 2, 222, { fit: [105, 105] });
    pdf.font('Helvetica-Bold').fontSize(11).fillColor('#3e4a55')
      .text('ROADMAP CERTIFICATE', bannerX + 8, 95, { width: bannerWidth - 16, align: 'center', characterSpacing: 1.2 });
    pdf.font('Helvetica-Bold').fontSize(8).fillColor('#3e4a55')
      .text('SCAN TO VERIFY', bannerX + 8, 337, { width: bannerWidth - 16, align: 'center', characterSpacing: 1 });

    pdf.font('Helvetica').fontSize(9).fillColor('#6a7681')
      .text('Verify this certificate at:', bannerX + 12, height - 118, { width: bannerWidth - 24, align: 'center' });
    pdf.font('Helvetica').fontSize(7).fillColor('#3e63b6')
      .text(verificationUrl, bannerX + 12, height - 103, {
        width: bannerWidth - 24,
        align: 'center',
        link: verificationUrl,
        underline: true,
      });
    pdf.font('Courier').fontSize(7).fillColor('#3e4a55')
      .text(`ID: ${details.code}`, bannerX + 12, height - 80, { width: bannerWidth - 24, align: 'center' });

    pdf.moveTo(contentLeft, height - 125).lineTo(contentLeft + 180, height - 125)
      .lineWidth(0.8).strokeColor('#cccccc').stroke();
    pdf.font('Times-Italic').fontSize(14).fillColor('#3e4a55')
      .text('NextStep AI Team', contentLeft, height - 151, { width: 180 });
    pdf.font('Helvetica').fontSize(8).fillColor('#8c98a3')
      .text('Platform Director', contentLeft, height - 116, { width: 180 });
    pdf.end();
    return;
  } catch (error) {
    return next(error);
  }
});

function serialize(document: Record<string, any>): Record<string, any> {
  const id = document._id.toString();
  return { ...document, _id: id, id };
}

export default router;

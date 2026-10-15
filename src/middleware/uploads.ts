import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { env } from '../config/env';

export const uploadDirectory = process.env.VERCEL
  ? path.join('/tmp', 'nextstep-uploads')
  : path.resolve(process.cwd(), 'storage', 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
  },
});

export const imageUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.mimetype) ||
        !['.jpg', '.jpeg', '.png', '.gif'].includes(path.extname(file.originalname).toLowerCase())) {
      callback(new Error('Only JPEG, PNG, and GIF images are allowed.'));
      return;
    }
    callback(null, true);
  },
});

export const resumePhotoUpload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype) ||
        !['.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase())) {
      callback(new Error('Only JPEG and PNG resume photos are allowed.'));
      return;
    }
    callback(null, true);
  },
});

export const resumePdfUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== 'application/pdf' || path.extname(file.originalname).toLowerCase() !== '.pdf') {
      callback(new Error('Only PDF resume files are allowed.'));
      return;
    }
    callback(null, true);
  },
});

export const practiceFileUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

export function publicUploadUrl(filename: string): string {
  return `${env.BACKEND_PUBLIC_URL.replace(/\/+$/, '')}/uploads/${encodeURIComponent(filename)}`;
}

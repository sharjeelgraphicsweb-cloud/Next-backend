import { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    message: 'Route not found',
    path: req.originalUrl,
  });
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Request failed', { name: err.name });

  if (err instanceof MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large.' : 'Invalid file upload.' });
    return;
  }
  if (err.name === 'SkillGapAnalysisError') {
    res.status(503).json({ message: err.message });
    return;
  }
  if (err.name === 'ResumeImprovementError') {
    res.status(503).json({ message: err.message });
    return;
  }
  if (err.message.startsWith('Only ') || err.message.startsWith('Only PDF')) {
    res.status(422).json({ message: err.message });
    return;
  }

  res.status(500).json({
    message: 'Internal server error',
  });
}

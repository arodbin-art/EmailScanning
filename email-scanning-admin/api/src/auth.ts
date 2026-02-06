import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'ADMIN_TOKEN is not configured' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const headerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : undefined;
  const apiToken = headerToken || (req.headers['x-admin-token'] as string | undefined);

  if (!apiToken || apiToken !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

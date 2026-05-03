export function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  res.status(401).json({ error: 'Não autorizado' });
}

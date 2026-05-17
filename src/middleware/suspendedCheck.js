// Blocks suspended users from performing any write actions.
// Returns a clear error message with the reason so the frontend can display it.
const suspendedCheck = (req, res, next) => {
  if (req.user?.suspended) {
    const reason = req.user.suspensionReason
      ? `Your account has been suspended: ${req.user.suspensionReason}`
      : "Your account has been suspended by an administrator. Please contact support.";
    return res.status(403).json({ error: reason, suspended: true });
  }
  next();
};

export default suspendedCheck;

const { RtcTokenBuilder, RtcRole } = require('agora-token');

module.exports = (req, res) => {
  const channel = req.query.channel;
  const uid = parseInt(req.query.uid || '0', 10);
  if (!channel) return res.status(400).json({ error: 'channel required' });

  const ttl = 6 * 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    process.env.AGORA_APP_ID,
    process.env.AGORA_APP_CERT,
    channel, uid, RtcRole.PUBLISHER, ttl, ttl
  );
  res.status(200).json({ token });
};

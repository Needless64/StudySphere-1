const Pusher = require('pusher');

let _pusher;

function getPusher() {
  if (!_pusher) {
    _pusher = new Pusher({
      appId:   process.env.PUSHER_APP_ID,
      key:     process.env.PUSHER_KEY,
      secret:  process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS:  true,
    });
  }
  return _pusher;
}

function trigger(channel, event, data) {
  if (!process.env.PUSHER_APP_ID) return; // skip if not configured
  try { getPusher().trigger(channel, event, data); } catch (e) { console.error('Pusher error:', e); }
}

module.exports = { trigger };

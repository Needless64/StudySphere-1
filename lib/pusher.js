const Pusher = require('pusher');

let _pusher;

function getPusher() {
  if (!_pusher) {
    _pusher = new Pusher({
      appId:   (process.env.PUSHER_APP_ID   || '').trim(),
      key:     (process.env.PUSHER_KEY      || '').trim(),
      secret:  (process.env.PUSHER_SECRET   || '').trim(),
      cluster: (process.env.PUSHER_CLUSTER  || '').trim(),
      useTLS:  true,
    });
  }
  return _pusher;
}

async function trigger(channel, event, data) {
  if (!process.env.PUSHER_APP_ID) return;
  try {
    await getPusher().trigger(channel, event, data);
  } catch (e) {
    console.error('Pusher trigger error:', e.message);
  }
}

module.exports = { trigger };

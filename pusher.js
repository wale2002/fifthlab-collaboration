// backend/pusher.js
const Pusher = require("pusher");

const pusher = new Pusher({
  app_id: "2009889",
  key: "836f3176a2c384401b6a",
  secret: "3cb40dbdca917a3ce057",
  cluster: "mt1",
  useTLS: true,
});

module.exports = pusher;

const crypto = require('crypto');

function createRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function isExpired(date) {
  return new Date(date).getTime() < Date.now();
}

module.exports = {
  createRandomToken,
  addMinutes,
  isExpired,
};

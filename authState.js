// authState.js
let loggedInUserId = null;

module.exports = {
  getLoggedInUserId: () => loggedInUserId,
  setLoggedInUserId: (id) => { loggedInUserId = id; },
  clearLoggedInUserId: () => { loggedInUserId = null; }
};

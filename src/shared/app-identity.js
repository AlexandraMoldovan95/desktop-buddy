'use strict';
// The identity of the portfolio edition. It is a SEPARATE app from the course one ("Desktop Buddy"):
// a different name, appId and data folder, so both can be installed and run side by side.
module.exports = Object.freeze({
  NAME: 'Desktop Buddy Portfolio',
  SHORT_NAME: 'Desktop Buddy',
  EDITION: 'Portfolio',
  APP_ID: 'ro.stepit.desktopbuddy.portfolio',
  DATA_DIR: 'Desktop Buddy Portfolio',   // %APPDATA%\Desktop Buddy Portfolio
});

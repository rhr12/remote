'use strict';
const readline = require('readline');
const { load } = require('../server/config');
const { createAuth } = require('../server/auth');
const cfg = load();
const auth = createAuth({ dataDir: cfg.dataDir });

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'.repeat(s.length ? 1 : 0)); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
(async () => {
  const pw = process.env.ADMIN_PASSWORD_ONCE || await ask('New admin password (min 10 chars): ');
  if (!process.env.ADMIN_PASSWORD_ONCE && pw !== await ask('Repeat password: ')) { console.error('Passwords do not match.'); process.exit(1); }
  try { auth.setPassword(pw); console.log('Admin password saved to ' + cfg.dataDir + '/admin.json (hashed). Restart not required.'); }
  catch (e) { console.error(e.message); process.exit(1); }
})();

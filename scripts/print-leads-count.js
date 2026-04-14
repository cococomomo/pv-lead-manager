'use strict';
/** Einmalige Diagnose: DB-Pfad + getAllLeads-Längen. */
require('../src/load-env');
const { getDbPath } = require('../src/database');
const { getAllLeads } = require('../src/sheets');

(async () => {
  const p = getDbPath();
  const a = await getAllLeads({ includeArchived: false });
  const b = await getAllLeads({ includeArchived: true });
  console.log(JSON.stringify({ dbPath: p, activeLeads: a.length, allLeads: b.length }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

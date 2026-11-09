const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
console.log('Searching root:', root);

function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f === '.git' || f === '.gemini') return;
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      const txt = fs.readFileSync(p, 'utf8');
      if (txt.includes("'apply'") || txt.includes('"apply"') || txt.includes('candidateAdd')) {
        console.log('Found:', p);
      }
    }
  });
}
walk(root);

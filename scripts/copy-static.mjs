import { cpSync, copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive:true });
copyFileSync('src/index.html','dist/index.html');
copyFileSync('src/styles.css','dist/styles.css');
cpSync('public','dist',{ recursive:true, force:true });

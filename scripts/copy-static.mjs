import { cpSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive:true });
copyFileSync('src/index.html','dist/index.html');
copyFileSync('src/styles.css','dist/styles.css');
if (existsSync('public')) cpSync('public','dist',{ recursive:true, force:true });

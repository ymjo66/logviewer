// SPDX-License-Identifier: GPL-3.0-only
// The Windows ICO container embeds the existing, unmodified 256px PNG logo.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const template=fs.readFileSync(path.join(root,'src/index.template.html'),'utf8');
const match=template.match(/<link rel="icon"[^>]*href="data:image\/png;base64,([^"]+)"/);
if(!match)throw Error('Embedded logo not found');
const png=Buffer.from(match[1],'base64'),head=Buffer.alloc(22);
head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);
fs.mkdirSync(path.join(root,'assets'),{recursive:true});
fs.writeFileSync(path.join(root,'assets/LogViewer.ico'),Buffer.concat([head,png]));
fs.writeFileSync(path.join(root,'assets/LogViewer.png'),png);
console.log('Created logo-based LogViewer.ico and LogViewer.png');

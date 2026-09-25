#!/usr/bin/env node
// Exercise the exact packaged dependency paths, not the development node_modules tree.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../web/', import.meta.url));
const font = fileURLToPath(new URL('../web/public/fonts/NotoSansKR-Regular.otf', import.meta.url));
const program = `
import PDF from 'pdfkit';
import ExcelJS from 'exceljs';
const doc = new PDF({autoFirstPage:false});
const chunks=[];
const completed=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',resolve);doc.on('error',reject);});
doc.registerFont('Korean',${JSON.stringify(font)});doc.addPage();doc.font('Korean').text('가공 보고서 synthetic');doc.end();await completed;
if(Buffer.concat(chunks).subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid packaged PDF');
const book=new ExcelJS.Workbook();book.addWorksheet('synthetic').addRow(['가공',12000]);
const bytes=Buffer.from(await book.xlsx.writeBuffer());if(bytes.subarray(0,2).toString()!=='PK')throw new Error('Invalid packaged XLSX');
console.log('Standalone Korean PDF and XLSX generation passed.');
`;
const result=spawnSync(process.execPath,['--input-type=module'],{cwd:web+'.next/standalone',input:program,encoding:'utf8',timeout:60000});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
process.exitCode=result.status??1;

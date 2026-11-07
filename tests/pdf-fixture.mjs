// Isolated test data; never part of the public app's catalog or user state.
export function certificatePDF({title='Software Architecture',provider='University of Alberta',owner='Test Learner',url='https://www.coursera.org/account/accomplishments/verify/TESTCERT123'}={}) {
 const escape=s=>s.replace(/([\\()])/g,'\\$1');
 const lines=['COURSE CERTIFICATE',owner,'has successfully completed',title,provider];
 const stream='BT /F1 18 Tf 50 720 Td '+lines.map((line,i)=>(i?'0 -30 Td ':'')+`(${escape(line)}) Tj`).join('\n')+' ET';
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  `<< /Type /Annot /Subtype /Link /Rect [50 450 550 500] /A << /S /URI /URI (${escape(url)}) >> >>`
 ];
 let output='%PDF-1.4\n',offsets=[0];
 objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
 const xref=Buffer.byteLength(output);
 output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
 output+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(output);
}

/* PDF and DOCX renderers for a resume document (see resumedoc.js). Browser only: they use the jsPDF
   and docx libraries the dashboard loads. The layout is exactly what the dashboard's own download
   buttons have always produced; it moved here so a version recorded when you applied can be
   downloaded again, byte-for-byte the same, without regenerating anything from your current profile. */

function rfSave(fileName,blob){
 const u=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=u;a.download=fileName;a.click();
 URL.revokeObjectURL(u);
}

function renderResumePDF(d,fileName){
 const {jsPDF}=window.jspdf;
 const pdf=new jsPDF({unit:"pt",format:"a4"});
 const pageWidth=pdf.internal.pageSize.getWidth(), pageHeight=pdf.internal.pageSize.getHeight();
 const marginX=42, maxWidth=pageWidth-marginX*2, marginBottom=48;
 let y=52;
 const ensureSpace=(lineHeight=12)=>{if(y+lineHeight>pageHeight-marginBottom){pdf.addPage();y=50;}};
 const writeBlock=(text,size=9.5,lineHeight=12)=>{
  pdf.setFont("helvetica","normal");pdf.setFontSize(size);
  String(text||"").split("\n").forEach(para=>{
   if(!para){ensureSpace(lineHeight/2);y+=lineHeight/2;return;}
   pdf.splitTextToSize(para,maxWidth).forEach(line=>{ensureSpace(lineHeight);pdf.text(line,marginX,y);y+=lineHeight;});
  });
 };
 const writeTwoCol=(left,right,size=10.2)=>{
  ensureSpace(13);
  pdf.setFont("helvetica","bold");pdf.setFontSize(size);
  pdf.text(left,marginX,y);
  if(right){pdf.setFont("helvetica","normal");pdf.setFontSize(9);pdf.text(right,marginX+maxWidth,y,{align:"right"});}
  y+=13;
 };
 const sectionTitle=title=>{
  ensureSpace(20);
  pdf.setFont("helvetica","bold");pdf.setFontSize(10.5);
  pdf.text(title.toUpperCase(),marginX,y);y+=4;
  pdf.setLineWidth(0.75);pdf.line(marginX,y,marginX+maxWidth,y);y+=12;
 };
 pdf.setFont("helvetica","bold");pdf.setFontSize(19);
 pdf.text((d.name||"YOUR NAME").toUpperCase(),marginX,y);y+=16;
 if(d.headline){pdf.setFont("helvetica","bold");pdf.setFontSize(10);pdf.text(d.headline.toUpperCase(),marginX,y);y+=13;}
 pdf.setFont("helvetica","normal");pdf.setFontSize(9);
 pdf.text(d.contact||" ",marginX,y);y+=16;

 sectionTitle("Professional Summary");writeBlock(d.summary);y+=8;

 sectionTitle("Core Skills");
 d.skillRows.forEach(g=>writeBlock(`${g.category}: ${g.items.join(", ")}`));
 y+=8;

 sectionTitle("Professional Experience");
 if(d.overridden){writeBlock(d.experienceText);}
 else{d.experience.forEach(e=>{writeTwoCol(e.title,e.meta);e.bullets.forEach(b=>writeBlock("• "+b));y+=4;});}
 y+=4;

 sectionTitle("Projects");
 if(d.overridden){writeBlock(d.projectsText);}
 else{d.projects.forEach(x=>{ensureSpace(13);pdf.setFont("helvetica","bold");pdf.setFontSize(10.2);pdf.text(x.title,marginX,y);y+=13;x.bullets.forEach(b=>writeBlock("• "+b));y+=4;});}
 y+=4;

 sectionTitle("Education");
 d.education.forEach(e=>{writeTwoCol(e.degree,e.date);writeBlock(e.detail);y+=4;});

 if(d.references.length){
  y+=4;sectionTitle("References");
  d.references.forEach(r=>{
   ensureSpace(12);pdf.setFont("helvetica","bold");pdf.setFontSize(9.5);pdf.text(r.name,marginX,y);y+=12;
   writeBlock(r.title,9);
   writeBlock(r.contact,9);
   y+=6;
  });
 }
 pdf.save(fileName);
}

async function renderResumeDOCX(d,fileName){
 const {Document,Packer,Paragraph,TextRun,TabStopType,TabStopPosition}=window.docx;
 const para=(text,opts={})=>new Paragraph({spacing:{after:opts.after??60},children:[new TextRun({text,bold:!!opts.bold,size:opts.size||20})]});
 const heading=text=>new Paragraph({spacing:{before:220,after:80},border:{bottom:{color:"000000",space:1,style:"single",size:6}},children:[new TextRun({text:text.toUpperCase(),bold:true,size:20})]});
 const bodyLines=text=>String(text||"").split("\n").map(line=>new Paragraph({spacing:{after:40},children:[new TextRun({text:line||" ",size:18})]}));
 const twoCol=(l,r)=>new Paragraph({tabStops:[{type:TabStopType.RIGHT,position:TabStopPosition.MAX}],spacing:{after:20},children:[new TextRun({text:l,bold:true,size:20}),new TextRun({text:"\t"+(r||""),size:18})]});

 const children=[para(d.name?d.name.toUpperCase():"YOUR NAME",{bold:true,size:32,after:40})];
 if(d.headline)children.push(para(d.headline.toUpperCase(),{bold:true,size:20,after:40}));
 children.push(para(d.contact||" ",{size:16,after:200}));

 children.push(heading("Professional Summary"),...bodyLines(d.summary));

 children.push(heading("Core Skills"));
 d.skillRows.forEach(g=>children.push(new Paragraph({spacing:{after:40},children:[new TextRun({text:`${g.category}: `,bold:true,size:18}),new TextRun({text:g.items.join(", "),size:18})]})));

 children.push(heading("Professional Experience"));
 if(d.overridden){children.push(...bodyLines(d.experienceText));}
 else{d.experience.forEach(e=>{
  children.push(twoCol(e.title,e.meta));
  e.bullets.forEach(b=>children.push(new Paragraph({spacing:{after:30},children:[new TextRun({text:"• "+b,size:18})]})));
 });}

 children.push(heading("Projects"));
 if(d.overridden){children.push(...bodyLines(d.projectsText));}
 else{d.projects.forEach(x=>{
  children.push(new Paragraph({spacing:{after:20},children:[new TextRun({text:x.title,bold:true,size:20})]}));
  x.bullets.forEach(b=>children.push(new Paragraph({spacing:{after:30},children:[new TextRun({text:"• "+b,size:18})]})));
 });}

 children.push(heading("Education"));
 d.education.forEach(e=>{
  children.push(twoCol(e.degree,e.date));
  children.push(new Paragraph({spacing:{after:60},children:[new TextRun({text:e.detail,size:18})]}));
 });

 if(d.references.length){
  children.push(heading("References"));
  d.references.forEach(r=>{
   children.push(new Paragraph({spacing:{after:10},children:[new TextRun({text:r.name,bold:true,size:18})]}));
   children.push(new Paragraph({spacing:{after:10},children:[new TextRun({text:r.title,size:16})]}));
   children.push(new Paragraph({spacing:{after:100},children:[new TextRun({text:r.contact,size:16})]}));
  });
 }

 const doc=new Document({sections:[{properties:{},children}]});
 rfSave(fileName,await Packer.toBlob(doc));
}

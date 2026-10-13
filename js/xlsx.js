// To do projets : générateur Excel (.xlsx) intégré, sans bibliothèque externe, fonctionnant hors connexion.
// Expose window.XlsxLite.buildXlsx(sheetName, rows, widths, headerRow) -> Blob
window.XlsxLite=(()=>{
  // Générateur Excel (.xlsx) intégré : aucune bibliothèque externe, fonctionne hors connexion
  const CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
  const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC_T[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0};
  function zipStore(files){ // [{name,data:string}] : archive ZIP sans compression
    const enc=new TextEncoder(), parts=[], central=[];let off=0;
    const u16=n=>[n&255,(n>>>8)&255], u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
    files.forEach(f=>{
      const name=enc.encode(f.name), data=enc.encode(f.data), crc=crc32(data);
      const head=[...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)];
      parts.push(new Uint8Array(head),name,data);
      central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(off)]),name);
      off+=head.length+name.length+data.length;
    });
    const cdSize=central.reduce((n,a)=>n+a.length,0);
    const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(cdSize),...u32(off),...u16(0)]);
    return new Blob([...parts,...central,end],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  }
  const xesc=s=>String(s??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const colL=i=>{let s="";i++;while(i){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s};
  // rows : tableaux de cellules {v, s} (v : texte, nombre ou Date) ; styles : 1 titre, 2 sous-titre, 3 en-tête, 4 texte, 5 date, 6-10 statuts
  function buildXlsx(sheetName,rows,widths,headerRow){
    const nCols=widths.length, lastRow=rows.length;
    const serial=d=>(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(1899,11,30))/864e5;
    const sd=rows.map((r,ri)=>`<row r="${ri+1}">${r.map((c,ci)=>{
      if(c==null||c.v==null||c.v==="")return c&&c.s?`<c r="${colL(ci)}${ri+1}" s="${c.s}"/>`:"";
      const ref=`${colL(ci)}${ri+1}`, st=c.s?` s="${c.s}"`:"";
      if(c.v instanceof Date)return `<c r="${ref}"${st}><v>${serial(c.v)}</v></c>`;
      if(typeof c.v==="number")return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xesc(c.v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const filt=`A${headerRow}:${colL(nCols-1)}${Math.max(headerRow,lastRow)}`;
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sd}</sheetData><autoFilter ref="${filt}"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="9"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="15"/><color rgb="FF16232B"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF51646F"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFB42318"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF5B3FA0"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF1F4A66"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF2F7D5B"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF3E5868"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D3240"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD5DDE2"/></left><right style="thin"><color rgb="FFD5DDE2"/></right><top style="thin"><color rgb="FFD5DDE2"/></top><bottom style="thin"><color rgb="FFD5DDE2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>${[4,5,6,7,8].map(f=>`<xf numFmtId="0" fontId="${f}" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>`).join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const sn=xesc(sheetName.slice(0,31).replace(/[\\\/\?\*\[\]:]/g," "));
    return zipStore([
      {name:"[Content_Types].xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`},
      {name:"_rels/.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
      {name:"xl/workbook.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sn}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sn.replace(/'/g,"''")}'!$A$${headerRow}:$${colL(nCols-1)}$${Math.max(headerRow,lastRow)}</definedName></definedNames></workbook>`},
      {name:"xl/_rels/workbook.xml.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
      {name:"xl/styles.xml",data:styles},
      {name:"xl/worksheets/sheet1.xml",data:sheet}
    ]);
  }
  return {buildXlsx,zipStore};
})();

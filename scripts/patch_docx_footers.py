#!/usr/bin/env python3
"""Post-process the diagnostic report docx:
1) patch footer PAGE instrText with explicit format switches (WPS compat):
   section-2 footer (Roman) -> PAGE \\* ROMAN \\* MERGEFORMAT
   section-3 footer (arabic) -> PAGE \\* arabic \\* MERGEFORMAT
   docx-js creates footer2.xml (TOC section) and footer3.xml (body) in order
   of first use; we detect by inspecting document.xml section order instead
   of guessing filenames.
2) remove empty <w:pgNumType/> from the cover section.
"""
import re, shutil, zipfile, os

path = "download/Top4_Coverage_Diagnostic_Report.docx"
tmp = path + ".tmp"

zin = zipfile.ZipFile(path, "r")
names = zin.namelist()

# --- map sections -> footer rIds from document.xml ---
doc = zin.read("word/document.xml").decode("utf-8")
rels = zin.read("word/_rels/document.xml.rels").decode("utf-8")

# find sectPr blocks in order
sect_blocks = re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, re.S)
rid2file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))

fmt_by_file = {}
for i, blk in enumerate(sect_blocks):
    fids = re.findall(r'w:footerReference[^>]*r:id="(rId\d+)"', blk)
    fmt = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', blk)
    fmtv = fmt.group(1) if fmt else None
    for fid in fids:
        f = rid2file.get(fid)
        if not f:
            continue
        if fmtv == "upperRoman":
            fmt_by_file[f] = "ROMAN"
        elif fmtv in ("decimal", None):
            fmt_by_file[f] = "arabic"

# --- remove empty pgNumType (cover section) ---
doc2 = re.sub(r"<w:pgNumType/>", "", doc)
changed_doc = doc2 != doc

with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        data = zin.read(n)
        if n == "word/document.xml" and changed_doc:
            data = doc2.encode("utf-8")
        else:
            base = os.path.basename(n)
            if n.startswith("word/footer") and base in fmt_by_file:
                xml = data.decode("utf-8")
                sw = fmt_by_file[base]
                xml2 = re.sub(
                    r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                    lambda m: m.group(1) + " PAGE \\* " + sw + " \\* MERGEFORMAT " + m.group(2),
                    xml)
                if xml2 != xml:
                    print(f"patched {base}: PAGE -> PAGE \\* {sw} \\* MERGEFORMAT")
                data = xml2.encode("utf-8")
        zout.writestr(n, data)
zin.close()
shutil.move(tmp, path)
print("pgNumType removed" if changed_doc else "no empty pgNumType found")
print("footer formats:", fmt_by_file)
print("done")

let jszipPromise;

async function loadJsZip() {
  if (!jszipPromise) {
    jszipPromise = import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  }

  const module = await jszipPromise;
  return module.default;
}

function xmlToText(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
  const textNodes = Array.from(xmlDoc.getElementsByTagName('w:t'));
  return textNodes.map((node) => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
}

export async function parseDocx(file) {
  const JSZip = await loadJsZip();
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');

  if (!documentXml) {
    throw new Error('Could not read DOCX content.');
  }

  return xmlToText(documentXml);
}

import { parsePdf } from './parser/pdfParser.js';
import { parseDocx } from './parser/docxParser.js';

function getExtension(filename = '') {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : '';
}

export async function extractTextFromFile(file) {
  if (!file) {
    throw new Error('No file selected.');
  }

  const extension = getExtension(file.name);

  if (extension === 'txt') {
    return file.text();
  }

  if (extension === 'pdf') {
    return parsePdf(file);
  }

  if (extension === 'docx') {
    return parseDocx(file);
  }

  throw new Error('Unsupported file format. Please upload TXT, PDF, or DOCX.');
}

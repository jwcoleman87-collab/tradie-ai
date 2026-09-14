const mimeByExtension: Record<string, string> = {
  csv: 'text/csv',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
};

export function uploadMime(filename: string, browserMime = '') {
  const declared = browserMime.split(';')[0].trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream')
    return declared === 'image/jpg' ? 'image/jpeg' : declared;
  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return (extension && mimeByExtension[extension]) || declared || '';
}

export const isHeifUpload = (mime: string) =>
  mime === 'image/heic' || mime === 'image/heif';

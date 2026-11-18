'use strict';

const { createServer } = require('node:http');
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { createReadStream, readFileSync } = require('node:fs');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { openPhotoStore } = require('./photo-store');

const port = Number(process.env.PORT || 3000);
const origin = new URL(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
const secure = origin.protocol === 'https:';
if (!secure && (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')) {
  throw new Error('PUBLIC_ORIGIN must use HTTPS outside local development.');
}

function localAccessCode() {
  try {
    return readFileSync(path.join(__dirname, '.private', 'admin-access-code'), 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

const accessCode = process.env.ADMIN_ACCESS_CODE || (!secure && localAccessCode());
if (accessCode && accessCode.length < 16) {
  throw new Error('The admin access code must contain at least 16 characters.');
}
const digest = value => createHash('sha256').update(value).digest();
const expectedCode = accessCode && digest(accessCode);
const cookieName = secure ? '__Host-photo_admin' : 'photo_admin';
const sessionDuration = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginFailures = [];
const maxImageBytes = 5 * 1024 * 1024;
const maxPhotos = 200;

const photos = expectedCode && openPhotoStore(
  path.resolve(process.env.PHOTO_DATA_DIR || path.join(__dirname, '.private'))
);
const storefrontPhotos = [
  ['red-coffee-tote.jpg', 'Coffee Shop Tote', 'Homepage and product catalog'],
  ['blue-coffee-tote.jpg', 'Blue Coffee Shop Tote', 'Product catalog'],
  ['blue-coffee-tote-detail.jpg', 'Blue Coffee Shop Tote Detail', 'Product catalog'],
  ['coffee-shop-painting.jpg', 'Coffee Shop Painting', 'Homepage, art gallery, and product catalog'],
  ['coffee-croissant-painting.jpg', 'Coffee & Croissant Painting', 'Art gallery and product catalog'],
  ['artwork-collection.jpg', 'Watercolor Miniatures', 'Homepage, art gallery, and product catalog'],
  ['bambi-intro.jpg', 'Studio Introduction', 'Homepage About section']
].map(([file, label, placement], index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  file, label, placement
}));
const storefrontById = new Map(storefrontPhotos.map(photo => [photo.id, photo]));
const storefrontByPath = new Map(storefrontPhotos.map(photo => [`/assets/products/${photo.file}`, photo]));

function storefrontPhoto(slot, includeImage = false) {
  const saved = photos?.read(slot.id, includeImage);
  if (saved) return saved;
  const photo = { label: slot.label, published: true, mime: 'image/jpeg' };
  if (includeImage) photo.image = readFileSync(path.join(__dirname, 'assets', 'products', slot.file));
  return photo;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const pages = new Set(['/index.html', '/products.html', '/style.css', '/app.js',
  '/display-photos.js', '/admin/photos.html', '/admin/photos.css', '/admin/photos.js']);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function readJson(request, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new RequestError(413, 'The upload is too large.');
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Invalid request data.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RequestError(400, 'Invalid request data.');
  }
  return input;
}

function sessionToken(request) {
  return request.headers.cookie?.split(/;\s*/)
    .find(cookie => cookie.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
}

function setSessionCookie(response, token, maxAge) {
  response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function imageData(value) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4) {
    throw new RequestError(400, 'Choose a JPEG, PNG, or WebP image.');
  }
  const image = Buffer.from(value, 'base64');
  if (image.length > maxImageBytes) throw new RequestError(413, 'Photos must be 5 MB or smaller.');

  let mime;
  if (image.length > 8 && image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mime = 'image/png';
  if (image.length > 4 && image.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) && image.readUInt16BE(image.length - 2) === 0xffd9) mime = 'image/jpeg';
  if (image.length > 16 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
  if (!mime) throw new RequestError(400, 'Choose a JPEG, PNG, or WebP image.');
  return { image, mime };
}

async function api(request, response, pathname) {
  if (!photos) throw new RequestError(503, 'Admin access has not been configured.');
  const { method } = request;
  if (method !== 'GET' && (
    request.headers.origin !== origin.origin ||
    request.headers['content-type']?.split(';')[0] !== 'application/json'
  )) {
    throw new RequestError(403, 'This request must come from the admin page.');
  }
  const token = sessionToken(request);
  const now = Date.now();
  if (pathname === '/api/admin/session' && method === 'POST') {
    const { code } = await readJson(request, 4096);
    while (loginFailures[0] <= now - 15 * 60 * 1000) loginFailures.shift();
    if (loginFailures.length >= 10) throw new RequestError(429, 'Too many attempts. Try again in 15 minutes.');
    if (typeof code !== 'string' || !timingSafeEqual(digest(code), expectedCode)) {
      loginFailures.push(now);
      throw new RequestError(401, 'Incorrect access code.');
    }
    loginFailures.length = 0;
    for (const [key, expiry] of sessions) {
      if (expiry <= now) sessions.delete(key);
    }
    sessions.delete(token);
    const newToken = randomBytes(32).toString('hex');
    sessions.set(newToken, now + sessionDuration);
    setSessionCookie(response, newToken, sessionDuration / 1000);
    return json(response, 200, { authenticated: true });
  }

  if (!(sessions.get(token) > now)) {
    sessions.delete(token);
    throw new RequestError(401, 'Admin sign-in required.');
  }
  if (pathname === '/api/admin/session' && method === 'DELETE') {
    sessions.delete(token);
    setSessionCookie(response, '', 0);
    return json(response, 200, { authenticated: false });
  }

  const collection = pathname === '/api/admin/photos';
  const match = /^\/api\/admin\/photos\/([a-f0-9-]{36})(\/image)?$/.exec(pathname);
  const slot = match && storefrontById.get(match[1]);
  if (collection && method === 'GET') {
    const placements = storefrontPhotos.map(entry => {
      const { label, published, updatedAt } = storefrontPhoto(entry);
      return { id: entry.id, placement: entry.placement, label, published, updatedAt };
    });
    return json(response, 200, [...placements, ...photos.list().filter(photo => !storefrontById.has(photo.id))]);
  }
  if (match?.[2] && method === 'GET') {
    const photo = slot ? storefrontPhoto(slot, true) : photos.read(match[1], true);
    if (!photo) throw new RequestError(404, 'Photo not found.');
    response.writeHead(200, { 'Content-Type': photo.mime, 'Content-Length': photo.image.length });
    return response.end(photo.image);
  }
  if (match && !match[2] && method === 'DELETE') {
    if (slot) throw new RequestError(409, 'Hide or replace this storefront photo from its editor.');
    if (!photos.remove(match[1])) throw new RequestError(404, 'Photo not found.');
    return json(response, 200, { id: match[1] });
  }

  const adding = collection && method === 'POST';
  const editing = match && !match[2] && method === 'PATCH';
  if (!adding && !editing) throw new RequestError(404, 'Route not found.');
  const input = await readJson(request, Math.ceil(maxImageBytes / 3) * 4 + 4096);
  if (!(sessions.get(token) > Date.now())) throw new RequestError(401, 'Admin sign-in required.');
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label || label.length > 100) throw new RequestError(400, 'Enter a photo name of 1 to 100 characters.');
  const replacement = adding || input.image !== undefined ? imageData(input.image) : undefined;
  const updatedAt = new Date().toISOString();
  const id = adding ? randomUUID() : match[1];
  if (adding) {
    if (photos.ids().filter(id => !storefrontById.has(id)).length >= maxPhotos) {
      throw new RequestError(409, 'The gallery has reached its 200-photo limit.');
    }
    photos.save(id, label, updatedAt, replacement, input.published === true);
  } else {
    const existing = slot ? storefrontPhoto(slot, !replacement) : photos.read(id, !replacement);
    if (!existing) throw new RequestError(404, 'Photo not found.');
    const published = input.published === undefined ? existing.published === true : input.published === true;
    photos.save(id, label, updatedAt, replacement || existing, published);
  }
  return json(response, adding ? 201 : 200, { id, label, updatedAt });
}

function displayPhotos(request, response, pathname) {
  if (request.method !== 'GET') throw new RequestError(404, 'Page not found.');
  if (pathname === '/api/display-photos') {
    const published = (photos?.list() || []).filter(photo => photo.published && !storefrontById.has(photo.id));
    return json(response, 200, published.map(({ id, label }) => ({ id, label })));
  }
  const match = /^\/api\/display-photos\/([a-f0-9-]{36})\/image$/.exec(pathname);
  if (match && storefrontById.has(match[1])) throw new RequestError(404, 'Photo not found.');
  const photo = match && photos?.read(match[1], true);
  if (photo?.published !== true) throw new RequestError(404, 'Photo not found.');
  const { image, mime } = photo;
  response.writeHead(200, { 'Content-Type': mime, 'Content-Length': image.length });
  response.end(image);
}

async function serve(request, response) {
  const pathname = new URL(request.url, origin).pathname;
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (pathname.startsWith('/api/') || pathname.startsWith('/admin/')) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  if (pathname === '/api/display-photos' || pathname.startsWith('/api/display-photos/')) {
    return displayPhotos(request, response, pathname);
  }
  if (pathname.startsWith('/api/')) return api(request, response, pathname);

  const filePath = pathname === '/' ? '/index.html' : pathname === '/admin/photos' ? '/admin/photos.html' : pathname;
  const placement = storefrontByPath.get(filePath.toLowerCase());
  if (placement && ['GET', 'HEAD'].includes(request.method)) {
    const photo = storefrontPhoto(placement, true);
    response.setHeader('Cache-Control', 'no-store');
    const image = photo.published ? photo.image : Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    response.writeHead(200, {
      'Content-Type': photo.published ? photo.mime : 'image/svg+xml',
      'Content-Length': image.length
    });
    return response.end(request.method === 'HEAD' ? undefined : image);
  }
  const extension = path.extname(filePath);
  const asset = /^\/assets\/(?:[\w-]+\/)*[\w.-]+$/.test(filePath) && mimeTypes[extension];
  if ((!pages.has(filePath) && !asset) || !['GET', 'HEAD'].includes(request.method)) {
    throw new RequestError(404, 'Page not found.');
  }
  const file = path.join(__dirname, filePath);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new RequestError(404, 'Page not found.');
  response.writeHead(200, { 'Content-Type': mimeTypes[extension], 'Content-Length': info.size });
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

createServer((request, response) => {
  serve(request, response).catch(error => {
    if (!error.status) console.error(error);
    if (response.headersSent) return response.destroy();
    json(response, error.status || 500, { error: error.status ? error.message : 'The request could not be completed.' });
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Storefront listening at http://127.0.0.1:${port}/`);
  if (!photos) console.log('Photo management is disabled until an admin access code is configured.');
});

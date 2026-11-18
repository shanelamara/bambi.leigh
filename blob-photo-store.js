'use strict';

const { get, put, list, del } = require('@vercel/blob');
const { recordName, encodePhoto, photoSummary, sortPhotos } = require('./photo-store');
const prefix = 'photos/';
const options = { access: 'private' };
const uncached = { ...options, useCache: false };

async function read(id, includeImage = false) {
  const blob = await get(prefix + id + '.photo', uncached);
  if (!blob || blob.statusCode !== 200) return null;
  if (includeImage) {
    const contents = Buffer.from(await new Response(blob.stream).arrayBuffer());
    const boundary = contents.indexOf(10);
    if (boundary < 0) throw new Error('Invalid photo record header.');
    return { ...JSON.parse(contents.toString('utf8', 0, boundary)), image: contents.subarray(boundary + 1) };
  }

  const reader = blob.stream.getReader();
  const chunks = [];
  let headerSize = 0;
  try {
    while (headerSize < 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value.subarray(0, 1024 - headerSize));
      const end = chunk.indexOf(10);
      chunks.push(end < 0 ? chunk : chunk.subarray(0, end));
      if (end >= 0) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      headerSize += chunk.length;
    }
    throw new Error('Invalid photo record header.');
  } finally {
    await reader.cancel();
  }
}

async function ids() {
  const result = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor });
    for (const blob of page.blobs) {
      const match = recordName.exec(blob.pathname.slice(prefix.length));
      if (match) result.push(match[1]);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return result;
}

async function listPhotos() {
  const photoIds = await ids();
  const result = [];
  for (let start = 0; start < photoIds.length; start += 8) {
    const batch = await Promise.all(photoIds.slice(start, start + 8).map(async id => {
      const metadata = await read(id);
      return metadata && photoSummary(id, metadata);
    }));
    result.push(...batch.filter(Boolean));
  }
  return sortPhotos(result);
}

async function save(id, label, updatedAt, photo, published) {
  await put(prefix + id + '.photo', encodePhoto(label, updatedAt, photo, published), {
    ...options, allowOverwrite: true, contentType: 'application/octet-stream'
  });
}

async function remove(id) {
  if (!await read(id)) return false;
  await del(prefix + id + '.photo');
  return true;
}

const sessionPath = token => 'sessions/' + token + '.json';
const sessions = {
  async get(token) {
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) return undefined;
    const entry = await get(sessionPath(token), uncached);
    if (entry?.statusCode === 200) return new Response(entry.stream).json();
    return undefined;
  },
  async set(token, expiry) {
    await put(sessionPath(token), JSON.stringify(expiry), { ...options, contentType: 'application/json' });
  },
  async delete(token) {
    if (/^[a-f0-9]{64}$/.test(token ?? '')) await del(sessionPath(token));
  }
};

module.exports = { photos: { ids, list: listPhotos, read, save, remove }, sessions };

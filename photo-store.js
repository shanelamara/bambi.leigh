'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const recordName = /^([a-f0-9-]{36})\.photo$/;
const headerLimit = 1024;

function encodePhoto(label, updatedAt, photo, published) {
  const header = Buffer.from(JSON.stringify({ label, updatedAt, mime: photo.mime, published }) + '\n');
  return Buffer.concat([header, photo.image]);
}

function photoSummary(id, metadata) {
  return { id, label: metadata.label, updatedAt: metadata.updatedAt, published: metadata.published === true };
}

function sortPhotos(photos) {
  return photos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function openPhotoStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  function filename(id) {
    return path.join(directory, id + '.photo');
  }

  function ids() {
    return fs.readdirSync(directory).map(name => recordName.exec(name)?.[1]).filter(Boolean);
  }

  function read(id, includeImage = false) {
    let handle;
    try {
      handle = fs.openSync(filename(id), 'r');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    try {
      // Each file starts with one JSON metadata line followed by the original image bytes.
      const header = Buffer.alloc(headerLimit);
      const bytesRead = fs.readSync(handle, header, 0, header.length, 0);
      const end = header.subarray(0, bytesRead).indexOf(10);
      if (end < 0) throw new Error('Invalid photo record header.');
      const metadata = JSON.parse(header.toString('utf8', 0, end));
      if (!includeImage) return metadata;
      const contents = fs.readFileSync(handle);
      return { ...metadata, image: contents.subarray(end + 1) };
    } finally {
      fs.closeSync(handle);
    }
  }

  function save(id, label, updatedAt, photo, published) {
    const temporary = path.join(directory, randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, encodePhoto(label, updatedAt, photo, published), {
        flag: 'wx',
        mode: 0o600,
        flush: true
      });
      fs.renameSync(temporary, filename(id));
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  function remove(id) {
    try {
      fs.unlinkSync(filename(id));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  function list() {
    const photos = [];
    for (const id of ids()) {
      const metadata = read(id);
      if (metadata) photos.push(photoSummary(id, metadata));
    }
    return sortPhotos(photos);
  }

  return { ids, list, read, save, remove };
}

module.exports = { openPhotoStore, recordName, encodePhoto, photoSummary, sortPhotos };
